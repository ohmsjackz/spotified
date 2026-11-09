"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Home, Search, Library, Plus, Play, Pause, SkipBack, SkipForward, Heart, Upload, ListMusic, X, LogIn, LogOut, Music2, Shuffle, Repeat, LoaderCircle } from "lucide-react";
import { supabase } from "@/lib/supabase";

type Track = { id:string; title:string; url:string; storagePath?:string; artist?:string; artwork?:string; source?:"upload"|"catalog" };
type Playlist = { id:string; name:string };
type Tab = "home"|"search"|"library";

export default function HomePage() {
  const [tab,setTab]=useState<Tab>("home"), [user,setUser]=useState<any>(null);
  const [username,setUsername]=useState(""), [password,setPassword]=useState(""), [authMode,setAuthMode]=useState<"login"|"signup">("login"), [showAuth,setShowAuth]=useState(false);
  const [tracks,setTracks]=useState<Track[]>([]), [playlists,setPlaylists]=useState<Playlist[]>([]), [activePlaylistId,setActivePlaylistId]=useState(""), [playlistTrackIds,setPlaylistTrackIds]=useState<string[]>([]);
  const [liked,setLiked]=useState<string[]>([]), [query,setQuery]=useState(""), [catalog,setCatalog]=useState<Track[]>([]), [searching,setSearching]=useState(false);
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
      return data?.signedUrl?{id:r.id,title:r.title,url:data.signedUrl,storagePath:r.storage_path,source:"upload" as const}:null;
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
    const authError = new URLSearchParams(window.location.hash.slice(1)).get("error_description");
    if(authError) setMessage(decodeURIComponent(authError.replace(/\\+/g," ")));
    void finish();
    supabase.auth.getSession().then(({data,error})=>{
      if(!alive)return;
      if(error)setMessage(error.message);
      const current=data.session?.user??null;setUser(current);if(current)void load(current.id);
    });
    const {data:{subscription}}=supabase.auth.onAuthStateChange((event,session)=>{
      const current=session?.user??null;setUser(current);
      if(current)void load(current.id);else{setTracks([]);setPlaylists([]);setLiked([]);setPlaying("");}
      if(event==="SIGNED_IN"&&session){setShowAuth(false);setMessage("Signed in.");}
    });
    return()=>{alive=false;subscription.unsubscribe();};
  },[load]);

  async function signIn(e:React.FormEvent){
    e.preventDefault(); if(!supabase)return;
    const clean=username.trim().toLowerCase();
    if(!/^[a-z0-9_]{3,20}$/.test(clean)){setMessage("Username must be 3–20 characters using letters, numbers or underscores.");return;}
    if(password.length<8){setMessage("Password must be at least 8 characters.");return;}
    setBusy(true);setMessage("");
    const email=clean+"@users.spotified.invalid";
    if(authMode==="signup"){
      const {data,error}=await supabase.functions.invoke("username-signup",{body:{username:clean,password}});
      if(error||data?.error){setBusy(false);setMessage(data?.error??error?.message??"Could not create account.");return;}
    }
    const {error}=await supabase.auth.signInWithPassword({email,password});
    setBusy(false);
    if(error)setMessage(authMode==="signup"?"Account created, but sign-in failed. Try signing in.":error.message);
    else setMessage("Signed in.");
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
      const {error}=await supabase.from("saved_tracks").insert({user_id:user.id,track_id:t.id,track_data:{title:t.title,artist:t.artist,preview_url:t.source==="catalog"?t.url:undefined,artwork:t.artwork,source:t.source}});
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
  useEffect(()=>{\n    const term=query.trim();\n    if(term.length<2){setCatalog([]);setSearching(false);return;}\n    const controller=new AbortController();\n    const timer=window.setTimeout(async()=>{\n      setSearching(true);\n      try{\n        const res=await fetch("https://itunes.apple.com/search?"+new URLSearchParams({term,media:"music",entity:"song",limit:"25"}),{signal:controller.signal});\n        if(!res.ok)throw new Error("Music search is temporarily unavailable.");\n        const data=await res.json();\n        setCatalog((data.results??[]).filter((x:any)=>x.previewUrl).map((x:any)=>({id:"apple-"+x.trackId,title:x.trackName,artist:x.artistName,url:x.previewUrl,artwork:x.artworkUrl100,source:"catalog" as const})));\n      }catch(e:any){if(e.name!=="AbortError")setMessage(e.message??"Music search failed.");}\n      finally{if(!controller.signal.aborted)setSearching(false);}\n    },350);\n    return()=>{window.clearTimeout(timer);controller.abort();};\n  },[query]);\n\n  const current=tracks.find(t=>t.id===playing)||catalog.find(t=>t.id===playing);
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
      {showAuth?<section className="auth-panel"><button className="text-button" onClick={()=>setShowAuth(false)}>‹ Back</button><div className="auth-icon"><Music2 size={25}/></div><p className="overline">SPOTIFIED ACCOUNT</p><h2>{authMode==="login"?"Welcome back":"Create your account"}</h2>
        <p>{authMode==="login"?"Sign in with your username and password.":"Choose a username and password to save your music and playlists."}</p>
        <form onSubmit={signIn}><label htmlFor="username">Username</label><input id="username" type="text" autoCapitalize="none" autoCorrect="off" autoComplete="username" placeholder="your_username" value={username} onChange={e=>setUsername(e.target.value)} minLength={3} maxLength={20} required/><label htmlFor="password">Password</label><input id="password" type="password" autoComplete={authMode==="login"?"current-password":"new-password"} placeholder="At least 8 characters" value={password} onChange={e=>setPassword(e.target.value)} minLength={8} required/><button className="action-button" disabled={busy}>{busy?<LoaderCircle className="spin"/>:authMode==="login"?"Sign in":"Create account"}</button></form>
        <button className="text-button" onClick={()=>{setAuthMode(authMode==="login"?"signup":"login");setMessage("");}}>{authMode==="login"?"New here? Create an account":"Already have an account? Sign in"}</button>
        {message&&<p className="status-message">{message}</p>}<small>No email verification or Google sign-in required.</small>
      </section>:tab==="home"?<>
        {!user&&<section className="welcome"><div><p className="overline">YOUR PERSONAL MUSIC LIBRARY</p><h2>Your music starts here.</h2><p>Sign in to upload tracks, save favorites and create playlists.</p></div><button className="action-button" onClick={()=>setShowAuth(true)}>Sign in</button></section>}
        <section className="section"><div className="section-title"><h2>Recently added</h2><button className="text-button" onClick={()=>changeTab("library")}>See all</button></div>
          {tracks.length?<TrackList tracks={tracks.slice(0,10)} playing={playing} liked={liked} onPlay={play} onLike={like} onAdd={addToPlaylist}/>:<div className="empty"><Music2 size={26}/><p>{user?"Your library is empty. Add music you own to get started.":"Your music will appear here after you sign in."}</p>{user&&<button className="secondary-button" onClick={()=>picker.current?.click()}><Upload size={16}/> Add music</button>}</div>}
        </section>
        {likedTracks.length>0&&<section className="section"><div className="section-title"><h2>Liked Songs</h2></div><TrackList tracks={likedTracks.slice(0,5)} playing={playing} liked={liked} onPlay={play} onLike={like} onAdd={addToPlaylist}/></section>}
      </>:tab==="search"?<>
        <div className="search-field"><Search size={19}/><input value={query} onChange={e=>setQuery(e.target.value)} placeholder="What do you want to play?"/>{query&&<button onClick={()=>setQuery("")} aria-label="Clear"><X size={17}/></button>}</div>
        <section className="section"><div className="section-title"><h2>{query?"Search results":"Explore music"}</h2><span>{searching?"Searching…":catalog.length+" songs"}</span></div>
          {catalog.length?<TrackList tracks={catalog} playing={playing} liked={liked} onPlay={play} onLike={like} onAdd={addToPlaylist}/>:<div className="empty"><p>{searching?"Searching the music catalogue…":query.length>1?"No playable previews found. Try another search.":"Search for songs, artists or albums. Available previews can be played here."}</p></div>}
          {query&&filtered.length>0&&<><h3 className="subheading">Your uploads</h3><TrackList tracks={filtered} playing={playing} liked={liked} onPlay={play} onLike={like} onAdd={addToPlaylist}/></>}
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
      <div className="mini-player"><div className="cover">{current.artwork?<img src={current.artwork} alt="" />:<Music2 size={19}/>}</div><div className="track-meta"><b>{current.title}</b><span>{current.artist??(current.source==="catalog"?"Apple Music preview":"Uploaded music")}</span></div><button className="player-icon" onClick={()=>void like(current)} aria-label="Like"><Heart size={19} fill={liked.includes(current.id)?"currentColor":"none"}/></button><button className="player-icon" onClick={()=>void play(current)} aria-label={isPlaying?"Pause":"Play"}>{isPlaying?<Pause size={20}/>:<Play size={20}/>}</button></div>
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
      if(shuffle&&tracks.length+catalog.length>1){const list=[...tracks,...catalog].filter(t=>t.id!==playing);const next=list[Math.floor(Math.random()*list.length)];if(next)void play(next);}
      else skip(1);
    }}/>
  </main>;
}

function TrackList({tracks,playing,liked,onPlay,onLike,onAdd}:{tracks:Track[];playing:string;liked:string[];onPlay:(t:Track)=>void;onLike:(t:Track)=>void;onAdd:(t:Track)=>void}){
  return <div className="track-list">{tracks.map((t,i)=><div className="track-row" key={t.id}><button className="track-art" onClick={()=>onPlay(t)} aria-label={"Play "+t.title}>{t.artwork?<img src={t.artwork} alt="" />:playing===t.id?<Pause size={17}/>:<Music2 size={18}/>}</button><button className="track-name" onClick={()=>onPlay(t)}><b>{t.title}</b><span>{t.artist??(t.source==="catalog"?"30-second preview":"Your upload")}</span></button><button className="like" onClick={()=>onAdd(t)} aria-label="Add to playlist"><ListMusic size={17}/></button><button className={"like "+(liked.includes(t.id)?"liked":"")} onClick={()=>onLike(t)} aria-label="Like track"><Heart size={18} fill={liked.includes(t.id)?"currentColor":"none"}/></button><span className="track-index">{i+1}</span></div>)}</div>;
}
function time(v:number){if(!Number.isFinite(v)||v<0)return "0:00";return Math.floor(v/60)+":"+String(Math.floor(v%60)).padStart(2,"0");}
