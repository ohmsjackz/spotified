"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Home, Search, Library, Plus, Play, Pause, SkipBack, SkipForward, Heart, Upload, ListMusic, X, LogIn, LogOut, Music2, Shuffle, Repeat, LoaderCircle } from "lucide-react";
import { supabase } from "@/lib/supabase";

type Track = { id:string; title:string; url:string; storagePath:string };
type Playlist = { id:string; name:string };
type Tab = "home"|"search"|"library";

export default function HomePage() {
  const [tab,setTab]=useState<Tab>("home"), [user,setUser]=useState<any>(null);
  const [email,setEmail]=useState(""), [showAuth,setShowAuth]=useState(false), [sent,setSent]=useState(false);
  const [tracks,setTracks]=useState<Track[]>([]), [playlists,setPlaylists]=useState<Playlist[]>([]), [activePlaylistId,setActivePlaylistId]=useState(""), [playlistTrackIds,setPlaylistTrackIds]=useState<string[]>([]);
  const [liked,setLiked]=useState<string[]>([]), [query,setQuery]=useState("");
  const [playing,setPlaying]=useState(""), [isPlaying,setIsPlaying]=useState(false);
  const [duration,setDuration]=useState(0), [currentTime,setCurrentTime]=useState(0);
  const [shuffle,setShuffle]=useState(false), [repeat,setRepeat]=useState(false);
  const [busy,setBusy]=useState(false), [message,setMessage]=useState("");
  const audio=useRef<HTMLAudioElement>(null), picker=useRef<HTMLInputElement>(null);

  const load = useCallback(async (uid:string) => {
    if(!supabase) return;
    const [a,b,c]=await Promise.all([
      supabase.from("uploaded_tracks").select("id,title,storage_path").eq("user_id",uid).order("created_at",{ascending:false}),
      supabase.from("user_playlists").select("id,name").eq("user_id",uid).order("created_at",{ascending:false}),
      supabase.from("saved_tracks").select("track_id").eq("user_id",uid)
    ]);
    if(a.error){setMessage(a.error.message);return;}
    const rows=await Promise.all((a.data??[]).map(async (r:any)=>{
      const {data}=await supabase!.storage.from("user-audio").createSignedUrl(r.storage_path,3600);
      return data?.signedUrl?{id:r.id,title:r.title,url:data.signedUrl,storagePath:r.storage_path}:null;
    }));
    setTracks(rows.filter(Boolean) as Track[]);
    setPlaylists((b.data??[]) as Playlist[]);
    setLiked((c.data??[]).map((x:any)=>x.track_id));
  },[]);

  useEffect(()=>{
    if(!supabase)return;
    let alive=true;
    const finish=async()=>{
      const u=new URL(window.location.href), code=u.searchParams.get("code");
      if(code){
        const {error}=await supabase!.auth.exchangeCodeForSession(code);
        u.searchParams.delete("code"); window.history.replaceState({},document.title,u.pathname+u.search+u.hash);
        if(error)setMessage("Email verification failed. Request a new link and open it in the same browser.");
      }
    };
    void finish();
    supabase.auth.getSession().then(({data,error})=>{
      if(!alive)return;
      if(error)setMessage(error.message);
      const current=data.session?.user??null;setUser(current);if(current)void load(current.id);
    });
    const {data:{subscription}}=supabase.auth.onAuthStateChange((event,session)=>{
      const current=session?.user??null;setUser(current);
      if(current)void load(current.id);else{setTracks([]);setPlaylists([]);setLiked([]);setPlaying("");}
      if(event==="SIGNED_IN"&&session){setShowAuth(false);setSent(false);setMessage("Signed in.");}
    });
    return()=>{alive=false;subscription.unsubscribe();};
  },[load]);

  async function signIn(e:React.FormEvent){
    e.preventDefault(); if(!supabase)return;
    setBusy(true);setMessage("");
    const {error}=await supabase.auth.signInWithOtp({email:email.trim(),options:{emailRedirectTo:window.location.origin,shouldCreateUser:true}});
    setBusy(false);
    if(error)setMessage(error.message);else{setSent(true);setMessage("Email sent. Open the newest link in this same browser.");}
  }
  async function upload(file?:File){
    if(!file||!supabase||!user)return;
    if(!file.type.startsWith("audio/")){setMessage("Choose an audio file.");return;}
    if(file.size>50*1024*1024){setMessage("Maximum file size is 50 MB.");return;}
    setBusy(true);
    const path=user.id+"/"+Date.now()+"-"+file.name.replace(/[^a-zA-Z0-9._-]/g,"_");
    const up=await supabase.storage.from("user-audio").upload(path,file);
    if(up.error){setBusy(false);setMessage(up.error.message);return;}
    const row=await supabase.from("uploaded_tracks").insert({user_id:user.id,storage_path:path,title:file.name.replace(/\.[^.]+$/,"")}).select("id,title,storage_path").single();
    if(row.error){setBusy(false);setMessage(row.error.message);return;}
    const signed=await supabase.storage.from("user-audio").createSignedUrl(path,3600);
    if(signed.error||!signed.data?.signedUrl){setBusy(false);setMessage("Uploaded, but playback URL failed. Refresh the library.");return;}
    setTracks(v=>[{id:row.data.id,title:row.data.title,url:signed.data.signedUrl,storagePath:path},...v]);
    setBusy(false);setMessage("Added to your library.");if(picker.current)picker.current.value="";
  }
  async function play(t:Track){
    if(!audio.current)return;
    if(playing===t.id){
      if(audio.current.paused){try{await audio.current.play();}catch{setMessage("Playback failed.");}}
      else audio.current.pause();
      return;
    }
    audio.current.src=t.url;audio.current.load();
    try{await audio.current.play();setPlaying(t.id);setCurrentTime(0);}catch{setMessage("This audio format cannot be played in Safari.");}
  }
  async function like(t:Track){
    if(!supabase||!user){setShowAuth(true);return;}
    if(liked.includes(t.id)){
      const {error}=await supabase.from("saved_tracks").delete().eq("user_id",user.id).eq("track_id",t.id);
      if(error)setMessage(error.message);else setLiked(v=>v.filter(x=>x!==t.id));
    }else{
      const {error}=await supabase.from("saved_tracks").insert({user_id:user.id,track_id:t.id,track_data:{title:t.title}});
      if(error)setMessage(error.message);else setLiked(v=>[...v,t.id]);
    }
  }
  async function createPlaylist(){
    if(!supabase||!user){setShowAuth(true);return;}
    const name=window.prompt("Playlist name");if(!name?.trim())return;
    const {data,error}=await supabase.from("user_playlists").insert({user_id:user.id,name:name.trim()}).select("id,name").single();
    if(error)setMessage(error.message);else{setPlaylists(v=>[data as Playlist,...v]);setMessage("Playlist created.");}
  }
  async function addToPlaylist(t:Track){
    if(!supabase||!user){setShowAuth(true);return;}
    if(!playlists.length){setMessage("Create a playlist first.");return;}
    const name=window.prompt("Type a playlist name:\\n"+playlists.map(p=>p.name).join("\\n"));
    const target=playlists.find(p=>p.name.toLowerCase()===name?.trim().toLowerCase());
    if(!target){setMessage("Playlist not found. Check the name and try again.");return;}
    const {error}=await supabase.from("playlist_tracks").insert({playlist_id:target.id,track_id:t.id,user_id:user.id});
    if(error)setMessage(error.code==="23505"?"That track is already in this playlist.":error.message);else setMessage("Added to "+target.name+".");
  }
  async function openPlaylist(p:Playlist){
    if(!supabase||!user)return;
    const {data,error}=await supabase.from("playlist_tracks").select("track_id").eq("playlist_id",p.id).eq("user_id",user.id);
    if(error){setMessage(error.message);return;}
    setPlaylistTrackIds((data??[]).map((x:any)=>x.track_id));setActivePlaylistId(p.id);
  }
  const current=tracks.find(t=>t.id===playing);
  const filtered=useMemo(()=>tracks.filter(t=>t.title.toLowerCase().includes(query.toLowerCase())),[tracks,query]);
  const likedTracks=tracks.filter(t=>liked.includes(t.id));
  function changeTab(t:Tab){setTab(t);setShowAuth(false);}
  function skip(dir:number){
    if(!tracks.length)return;
    const i=tracks.findIndex(t=>t.id===playing), n=(i+dir+tracks.length)%tracks.length;
    void play(tracks[n]);
  }

  return <main className="app-shell">
    <header className="app-header"><div><p className="overline">{tab==="home"?"LISTEN NOW":tab==="search"?"FIND MUSIC":"YOUR COLLECTION"}</p><h1>{tab==="home"?"Home":tab==="search"?"Search":"Your Library"}</h1></div>
      <button className="account-button" aria-label={user?"Sign out":"Sign in"} onClick={()=>user?void supabase?.auth.signOut():setShowAuth(v=>!v)}>{user?<LogOut size={20}/>:<LogIn size={20}/>}</button>
    </header>
    <section className="page-content">
      {showAuth?<section className="auth-panel"><button className="text-button" onClick={()=>setShowAuth(false)}>‹ Back</button><div className="auth-icon"><Music2 size={25}/></div><p className="overline">EMAIL ACCOUNT</p><h2>{sent?"Check your inbox":"Sign in to Spotified"}</h2>
        {sent?<><p>We sent a sign-in link to <b>{email}</b>. Open the newest email in the same browser where you requested it. If it expired, request a fresh one.</p><button className="action-button" onClick={()=>setSent(false)}>Use another email</button></>:<><p>Save your music, playlists and uploads to your private library.</p><form onSubmit={signIn}><label htmlFor="email">Email address</label><input id="email" type="email" inputMode="email" autoComplete="email" placeholder="you@example.com" value={email} onChange={e=>setEmail(e.target.value)} required/><button className="action-button" disabled={busy}>{busy?<LoaderCircle className="spin"/>:"Continue with email"}</button></form></>}
        {message&&<p className="status-message">{message}</p>}<small>No Google sign-in. Email only.</small>
      </section>:tab==="home"?<>
        {!user&&<section className="welcome"><div><p className="overline">YOUR PERSONAL MUSIC LIBRARY</p><h2>Your music starts here.</h2><p>Sign in to upload tracks, save favorites and create playlists.</p></div><button className="action-button" onClick={()=>setShowAuth(true)}>Sign in</button></section>}
        <section className="section"><div className="section-title"><h2>Recently added</h2><button className="text-button" onClick={()=>changeTab("library")}>See all</button></div>
          {tracks.length?<TrackList tracks={tracks.slice(0,10)} playing={playing} liked={liked} onPlay={play} onLike={like} onAdd={addToPlaylist}/>:<div className="empty"><Music2 size={26}/><p>{user?"Your library is empty. Add music you own to get started.":"Your music will appear here after you sign in."}</p>{user&&<button className="secondary-button" onClick={()=>picker.current?.click()}><Upload size={16}/> Add music</button>}</div>}
        </section>
        {likedTracks.length>0&&<section className="section"><div className="section-title"><h2>Liked Songs</h2></div><TrackList tracks={likedTracks.slice(0,5)} playing={playing} liked={liked} onPlay={play} onLike={like} onAdd={addToPlaylist}/></section>}
      </>:tab==="search"?<>
        <div className="search-field"><Search size={19}/><input value={query} onChange={e=>setQuery(e.target.value)} placeholder="What do you want to play?"/>{query&&<button onClick={()=>setQuery("")} aria-label="Clear"><X size={17}/></button>}</div>
        <section className="section"><div className="section-title"><h2>{query?"Results":"Your music"}</h2><span>{filtered.length} tracks</span></div>
          {filtered.length?<TrackList tracks={filtered} playing={playing} liked={liked} onPlay={play} onLike={like} onAdd={addToPlaylist}/>:<div className="empty"><p>{user?"No matching tracks in your library.":"Sign in to search your music."}</p>{!user&&<button className="secondary-button" onClick={()=>setShowAuth(true)}>Sign in</button>}</div>}
        </section>
      </>:<>
        <div className="library-actions"><button className="secondary-button" onClick={createPlaylist}><Plus size={17}/> Create playlist</button><button className="secondary-button" disabled={!user} onClick={()=>picker.current?.click()}><Upload size={17}/> Add music</button></div>
        {playlists.length>0&&<section className="section"><h2 className="subheading">Playlists</h2>{activePlaylistId?<><button className="text-button" onClick={()=>setActivePlaylistId("")}>‹ All playlists</button><TrackList tracks={tracks.filter(t=>playlistTrackIds.includes(t.id))} playing={playing} liked={liked} onPlay={play} onLike={like} onAdd={addToPlaylist}/></>:playlists.map(p=><button className="playlist-row" key={p.id} onClick={()=>void openPlaylist(p)}><span className="playlist-icon"><ListMusic size={19}/></span><b>{p.name}</b></button>)}</section>}
        <section className="section"><h2 className="subheading">Liked Songs</h2>{likedTracks.length?<TrackList tracks={likedTracks} playing={playing} liked={liked} onPlay={play} onLike={like} onAdd={addToPlaylist}/>:<div className="empty"><p>Tracks you like will appear here.</p></div>}</section>
        <section className="section"><h2 className="subheading">Your uploads</h2>{tracks.length?<TrackList tracks={tracks} playing={playing} liked={liked} onPlay={play} onLike={like} onAdd={addToPlaylist}/>:<div className="empty"><p>No uploaded tracks yet.</p></div>}</section>
        {!user&&<button className="action-button" onClick={()=>setShowAuth(true)}>Sign in</button>}
      </>}
    </section>
    <input ref={picker} className="hidden" type="file" accept="audio/*" onChange={e=>void upload(e.target.files?.[0])}/>
    {message&&!showAuth&&<div className="toast" role="status">{message}<button onClick={()=>setMessage("")}><X size={15}/></button></div>}
    {current&&<section className="player">
      <div className="mini-player"><div className="cover"><Music2 size={19}/></div><div className="track-meta"><b>{current.title}</b><span>Uploaded music</span></div><button className="player-icon" onClick={()=>void like(current)} aria-label="Like"><Heart size={19} fill={liked.includes(current.id)?"currentColor":"none"}/></button><button className="player-icon" onClick={()=>void play(current)} aria-label={isPlaying?"Pause":"Play"}>{isPlaying?<Pause size={20}/>:<Play size={20}/>}</button></div>
      <div className="progress"><span>{time(currentTime)}</span><input type="range" min="0" max={duration||0} value={Math.min(currentTime,duration||0)} onChange={e=>{const n=Number(e.target.value);if(audio.current)audio.current.currentTime=n;setCurrentTime(n);}}/><span>{time(duration)}</span></div>
      <div className="controls"><button className={shuffle?"selected-control":""} onClick={()=>setShuffle(v=>!v)} aria-label="Shuffle"><Shuffle size={17}/></button><button onClick={()=>skip(-1)} aria-label="Previous"><SkipBack size={20}/></button><button className="play-main" onClick={()=>void play(current)} aria-label="Play or pause">{isPlaying?<Pause size={20}/>:<Play size={20}/>}</button><button onClick={()=>skip(1)} aria-label="Next"><SkipForward size={20}/></button><button className={repeat?"selected-control":""} onClick={()=>setRepeat(v=>!v)} aria-label="Repeat"><Repeat size={17}/></button></div>
    </section>}
    <nav className="tab-bar" aria-label="Main navigation">
      <button className={tab==="home"?"active":""} onClick={()=>changeTab("home")}><Home size={22}/><span>Home</span></button>
      <button className={tab==="search"?"active":""} onClick={()=>changeTab("search")}><Search size={22}/><span>Search</span></button>
      <button className={tab==="library"?"active":""} onClick={()=>changeTab("library")}><Library size={22}/><span>Your Library</span></button>
    </nav>
    <audio ref={audio} preload="metadata" onLoadedMetadata={e=>setDuration(e.currentTarget.duration||0)} onTimeUpdate={e=>setCurrentTime(e.currentTarget.currentTime)} onPlay={()=>setIsPlaying(true)} onPause={()=>setIsPlaying(false)} onEnded={()=>{
      if(repeat&&audio.current){audio.current.currentTime=0;void audio.current.play();return;}
      if(shuffle&&tracks.length>1){const list=tracks.filter(t=>t.id!==playing);const next=list[Math.floor(Math.random()*list.length)];if(next)void play(next);}
      else skip(1);
    }}/>
  </main>;
}

function TrackList({tracks,playing,liked,onPlay,onLike,onAdd}:{tracks:Track[];playing:string;liked:string[];onPlay:(t:Track)=>void;onLike:(t:Track)=>void;onAdd:(t:Track)=>void}){
  return <div className="track-list">{tracks.map((t,i)=><div className="track-row" key={t.id}><button className="track-art" onClick={()=>onPlay(t)} aria-label={"Play "+t.title}>{playing===t.id?<Pause size={17}/>:<Music2 size={18}/>}</button><button className="track-name" onClick={()=>onPlay(t)}><b>{t.title}</b><span>Uploaded music</span></button><button className="like" onClick={()=>onAdd(t)} aria-label="Add to playlist"><ListMusic size={17}/></button><button className={"like "+(liked.includes(t.id)?"liked":"")} onClick={()=>onLike(t)} aria-label="Like track"><Heart size={18} fill={liked.includes(t.id)?"currentColor":"none"}/></button><span className="track-index">{i+1}</span></div>)}</div>;
}
function time(v:number){if(!Number.isFinite(v)||v<0)return "0:00";return Math.floor(v/60)+":"+String(Math.floor(v%60)).padStart(2,"0");}
