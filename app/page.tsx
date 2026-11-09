"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Home, Search, Library, Plus, Play, Pause, SkipBack, SkipForward, Heart, Upload, ListMusic, X, LogIn, LogOut, Music2, Shuffle, Repeat, LoaderCircle, ExternalLink, Download } from "lucide-react";
import { supabase } from "@/lib/supabase";

type Track = { id:string; title:string; url:string;  storagePath?:string; artist?:string; artwork?:string; source?:"upload"|"catalog"; license?:string; archiveUrl?:string; provider?:string; externalUrl?:string; downloadable?:boolean };
type Playlist = { id:string; name:string };
type Tab = "home"|"search"|"library";

export default function HomePage() {
  const [tab,setTab]=useState<Tab>("home"), [user,setUser]=useState<any>(null);
  const [username,setUsername]=useState(""), [password,setPassword]=useState(""), [authMode,setAuthMode]=useState<"login"|"signup">("login"), [showAuth,setShowAuth]=useState(false);
  const [tracks,setTracks]=useState<Track[]>([]), [playlists,setPlaylists]=useState<Playlist[]>([]), [activePlaylistId,setActivePlaylistId]=useState(""), [playlistTrackIds,setPlaylistTrackIds]=useState<string[]>([]);
  const [liked,setLiked]=useState<string[]>([]), [query,setQuery]=useState(""), [catalog,setCatalog]=useState<Track[]>([]), [searching,setSearching]=useState(false);
  const [playing,setPlaying]=useState(""), [activeTrack,setActiveTrack]=useState<Track|null>(null), [isPlaying,setIsPlaying]=useState(false);
  const [duration,setDuration]=useState(0), [currentTime,setCurrentTime]=useState(0);
  const [lyrics,setLyrics]=useState<string[]>([]), [lyricsOpen,setLyricsOpen]=useState(false), [lyricsLoading,setLyricsLoading]=useState(false), [lyricsMessage,setLyricsMessage]=useState("");
  const [shuffle,setShuffle]=useState(false), [repeat,setRepeat]=useState(false);
  const [busy,setBusy]=useState(false), [message,setMessage]=useState("");
  const audio=useRef<HTMLAudioElement>(null), picker=useRef<HTMLInputElement>(null);

  useEffect(()=>{
    try{
      const saved=sessionStorage.getItem("spotified-playback");
      if(!saved)return;
      const item=JSON.parse(saved) as {track:Track;position:number};
      if(!item?.track?.id||!item.track.url)return;
      if(item.track.source==="catalog")setCatalog(v=>v.some(t=>t.id===item.track.id)?v:[item.track,...v]);
      else setTracks(v=>v.some(t=>t.id===item.track.id)?v:[item.track,...v]);
      setPlaying(item.track.id);setActiveTrack(item.track);
      setCurrentTime(Number(item.position)||0);
      if(audio.current && item.track.url){audio.current.src=item.track.url;audio.current.load();}
    }catch{/* Ignore invalid saved playback state. */}
  },[]);

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
    setActiveTrack(t);
    if(!audio.current)return;
    if(playing===t.id){
      if(audio.current.paused){try{await audio.current.play();}catch{setMessage("Safari or Chrome could not start this stream. Try opening the audio directly.");}}
      else audio.current.pause();
      return;
    }
    audio.current.pause();
    audio.current.src=t.url;
    audio.current.load();
    setPlaying(t.id);
    try{sessionStorage.setItem("spotified-playback",JSON.stringify({track:t,position:0}));}catch{/* Storage may be unavailable. */}
    setCurrentTime(0);
    setDuration(0);
    try{await audio.current.play();}
    catch{setIsPlaying(false);setMessage("This stream could not start in this browser. Use Open audio to test the source directly.");}
  }
  async function like(t:Track){
    if(!supabase||!user){setShowAuth(true);return;}
    if(liked.includes(t.id)){
      const {error}=await supabase.from("saved_tracks").delete().eq("user_id",user.id).eq("track_id",t.id);
      if(error)setMessage(error.message);else setLiked(v=>v.filter(x=>x!==t.id));
    }else{
      const {error}=await supabase.from("saved_tracks").insert({user_id:user.id,track_id:t.id,track_data:{title:t.title,artist:t.artist,artwork:t.artwork,source:t.source}});
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
    if(t.source==="catalog"){setMessage("Streaming catalogue tracks can be liked, but personal playlists currently contain your uploaded files.");return;}
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
  useEffect(()=>{
    const term=query.trim();
    if(term.length<2){setCatalog([]);setSearching(false);return;}
    const controller=new AbortController();
    const timer=window.setTimeout(async()=>{
      setSearching(true);
      try{
        const res=await fetch("/api/catalog/search?q="+encodeURIComponent(term),{signal:controller.signal});
        const data=await res.json();
        if(!res.ok)throw new Error(data.error??"Music search is temporarily unavailable.");
        setCatalog((data.results??[]).map((x:any)=>({
          id:x.id,title:x.title,artist:x.artist,url:x.url,artwork:x.artwork,
          source:"catalog" as const,license:x.license,archiveUrl:x.archiveUrl,provider:x.provider,externalUrl:x.externalUrl,downloadable:x.downloadable
        })));
        if(!(data.results??[]).length)setMessage("No matches found. Try the song title and artist together.");
      }catch(e:any){if(e.name!=="AbortError")setMessage(e.message??"Music search failed.");}
      finally{if(!controller.signal.aborted)setSearching(false);}
    },450);
    return()=>{window.clearTimeout(timer);controller.abort();};
  },[query]);

  const current=(activeTrack?.id===playing?activeTrack:null)||tracks.find(t=>t.id===playing)||catalog.find(t=>t.id===playing);

  async function loadLyrics(){
    if(!current)return;
    setLyricsOpen(true);setLyricsLoading(true);setLyrics([]);setLyricsMessage("");
    try{
      const params=new URLSearchParams({track:current.title,artist:current.artist||""});
      if(duration>0)params.set("duration",String(Math.round(duration)));
      const response=await fetch("/api/lyrics?"+params.toString());
      const data=await response.json();
      if(!response.ok)throw new Error(data.error||"Lyrics unavailable.");
      const raw=data.lyrics?.syncedLyrics||data.lyrics?.plainLyrics||"";
      const lines=raw.split(/\r?\n/).map((line:string)=>line.replace(/^\[[0-9:.]+\]\s*/,"").trim()).filter(Boolean);
      setLyrics(lines);
      if(!lines.length)setLyricsMessage(data.message||"Lyrics aren't available for this track yet.");
    }catch(error:any){setLyricsMessage(error.message||"Couldn't load lyrics.");}
    finally{setLyricsLoading(false);}
  }

  // Publish the active track to the browser/OS Now Playing surface (Lock Screen and supported Dynamic Island UI).
  useEffect(()=>{
    if(!current || !("mediaSession" in navigator) || typeof MediaMetadata === "undefined") return;
    const session=navigator.mediaSession;
    session.metadata=new MediaMetadata({
      title:current.title,
      artist:current.artist || (current.source==="catalog"?(current.artist||"Unknown artist"):"Your music"),
      album:"Spotified",
      artwork:current.artwork?[{src:current.artwork,sizes:"512x512",type:"image/jpeg"}]:[]
    });
    return ()=>{ session.metadata=null; };
  },[current?.id,current?.title,current?.artist,current?.artwork,current?.source]);

  useEffect(()=>{
    if(!("mediaSession" in navigator)) return;
    const session=navigator.mediaSession;
    session.playbackState=isPlaying?"playing":playing?"paused":"none";
    const setHandler=(action:MediaSessionAction,handler:((details?:MediaSessionActionDetails)=>void)|null)=>{
      try{session.setActionHandler(action,handler);}catch{/* Unsupported action on this browser. */}
    };
    setHandler("play",()=>{if(audio.current?.paused)void audio.current.play();});
    setHandler("pause",()=>{audio.current?.pause();});
    setHandler("previoustrack",()=>skip(-1));
    setHandler("nexttrack",()=>skip(1));
    setHandler("seekto",details=>{
      if(audio.current && details?.seekTime!==undefined && Number.isFinite(details.seekTime)){
        audio.current.currentTime=details.seekTime;
        setCurrentTime(details.seekTime);
      }
    });
    if(duration>0){
      try{session.setPositionState({duration,playbackRate:audio.current?.playbackRate||1,position:Math.min(currentTime,duration)});}catch{/* Position state is optional. */}
    }
    return ()=>{
      setHandler("play",null);setHandler("pause",null);setHandler("previoustrack",null);setHandler("nexttrack",null);setHandler("seekto",null);
    };
  },[isPlaying,playing,duration,currentTime,tracks,catalog,shuffle,repeat]);
  const filtered=useMemo(()=>tracks.filter(t=>t.title.toLowerCase().includes(query.toLowerCase())),[tracks,query]);
  const likedTracks=tracks.filter(t=>liked.includes(t.id));
  function changeTab(t:Tab){setTab(t);setShowAuth(false);}
  function skip(dir:number){
    const queue=Array.from(new Map([...tracks,...catalog,...(activeTrack?[activeTrack]:[])].map(t=>[t.id,t])).values());
    if(!queue.length)return;
    const i=queue.findIndex(t=>t.id===playing);
    if(dir>0&&shuffle&&queue.length>1){
      const choices=queue.filter(t=>t.id!==playing);
      void play(choices[Math.floor(Math.random()*choices.length)]);
      return;
    }
    const n=(Math.max(i,0)+dir+queue.length)%queue.length;
    void play(queue[n]);
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
        <section className="home-hero"><div className="home-hero-copy"><p className="overline">MADE FOR YOUR MOMENT</p><h2>Find your next favorite.</h2><p>Explore music, discover new artists and pick up where you left off.</p><button className="hero-button" onClick={()=>changeTab("search")}><Search size={16}/> Explore music</button></div><div className="hero-art"><Music2 size={46}/></div></section>
        <div className="home-shortcuts"><button onClick={()=>changeTab("search")}><span className="shortcut-icon search-tile"><Search size={20}/></span><b>Discover music</b></button><button onClick={()=>changeTab("library")}><span className="shortcut-icon library-tile"><Library size={20}/></span><b>Your library</b></button></div>
        {!user&&<section className="welcome"><div><p className="overline">YOUR PERSONAL MUSIC LIBRARY</p><h2>Your music starts here.</h2><p>Sign in to upload tracks, save favorites and create playlists.</p></div><button className="action-button" onClick={()=>setShowAuth(true)}>Sign in</button></section>}
        <section className="section"><div className="section-title"><h2>Recently added</h2><button className="text-button" onClick={()=>changeTab("library")}>See all</button></div>
          {tracks.length?<TrackList tracks={tracks.slice(0,10)} playing={playing} liked={liked} onPlay={play} onLike={like} onAdd={addToPlaylist}/>:<div className="empty"><Music2 size={26}/><p>{user?"Your library is empty. Add music you own to get started.":"Your music will appear here after you sign in."}</p>{user&&<button className="secondary-button" onClick={()=>picker.current?.click()}><Upload size={16}/> Add music</button>}</div>}
        </section>
        {likedTracks.length>0&&<section className="section"><div className="section-title"><h2>Liked Songs</h2></div><TrackList tracks={likedTracks.slice(0,5)} playing={playing} liked={liked} onPlay={play} onLike={like} onAdd={addToPlaylist}/></section>}
      </>:tab==="search"?<>
        {!query&&<div className="browse-chips"><button onClick={()=>setQuery("pop")}>Pop</button><button onClick={()=>setQuery("chill")}>Chill</button><button onClick={()=>setQuery("indie")}>Indie</button><button onClick={()=>setQuery("electronic")}>Electronic</button></div>}
        
        <div className="search-field"><Search size={19}/><input value={query} onChange={e=>setQuery(e.target.value)} placeholder="What do you want to play?"/>{query&&<button onClick={()=>setQuery("")} aria-label="Clear"><X size={17}/></button>}</div>
        <section className="section"><div className="section-title"><h2>{query?"Search results":"Browse all"}</h2><span>{searching?"Searching…":catalog.length+" tracks"}</span></div>
          {catalog.length?<TrackList tracks={catalog} playing={playing} liked={liked} onPlay={play} onLike={like} onAdd={addToPlaylist}/>:<div className="empty"><p>{searching?"Searching the music catalogue…":query.length>1?"No matches yet. Try the song title and artist together, like “golden hour JVKE”.":"Search full-length tracks and artists. Short previews are not included."}</p></div>}
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
      <div className="mini-player"><div className="cover">{current.artwork?<img src={current.artwork} alt="" />:<Music2 size={19}/>}</div><div className="track-meta"><b>{current.title}</b><span>{current.artist??(current.source==="catalog"?(current.provider||"Music catalogue"):"Uploaded music")}</span></div><button className="player-icon" onClick={()=>void loadLyrics()} aria-label="Show lyrics"><span className="lyrics-icon">LYRICS</span></button><button className="player-icon" onClick={()=>void like(current)} aria-label="Like"><Heart size={19} fill={liked.includes(current.id)?"currentColor":"none"}/></button><button className="player-icon" onClick={()=>void play(current)} aria-label={isPlaying?"Pause":"Play"}>{isPlaying?<Pause size={20}/>:<Play size={20}/>}</button></div>
      <div className="progress"><span>{time(currentTime)}</span><input type="range" min="0" max={duration||0} value={Math.min(currentTime,duration||0)} onChange={e=>{const n=Number(e.target.value);if(audio.current)audio.current.currentTime=n;setCurrentTime(n);}}/><span>{time(duration)}</span></div>
      <div className="controls"><button className={shuffle?"selected-control":""} onClick={()=>setShuffle(v=>!v)} aria-label="Shuffle"><Shuffle size={17}/></button><button onClick={()=>skip(-1)} aria-label="Previous"><SkipBack size={20}/></button><button className="play-main" onClick={()=>void play(current)} aria-label="Play or pause">{isPlaying?<Pause size={20}/>:<Play size={20}/>}</button><button onClick={()=>skip(1)} aria-label="Next"><SkipForward size={20}/></button><button className={repeat?"selected-control":""} onClick={()=>setRepeat(v=>!v)} aria-label="Repeat"><Repeat size={17}/></button></div>
    </section>}
    {lyricsOpen&&<div className="lyrics-overlay" role="dialog" aria-modal="true" aria-label="Lyrics"><div className="lyrics-sheet"><div className="lyrics-head"><div><p className="overline">NOW PLAYING</p><h2>{current?.title||"Lyrics"}</h2><span>{current?.artist}</span></div><button onClick={()=>setLyricsOpen(false)} aria-label="Close lyrics"><X size={22}/></button></div>{lyricsLoading?<div className="lyrics-empty">Finding lyrics…</div>:lyrics.length?<div className="lyrics-lines">{lyrics.map((line,i)=><p key={i}>{line}</p>)}</div>:<div className="lyrics-empty">{lyricsMessage||"Lyrics aren't available for this track yet."}</div>}<small>Lyrics provided by LRCLIB where available.</small></div></div>}
    <nav className="tab-bar" aria-label="Main navigation">
      <button className={tab==="home"?"active":""} onClick={()=>changeTab("home")}><Home size={22}/><span>Home</span></button>
      <button className={tab==="search"?"active":""} onClick={()=>changeTab("search")}><Search size={22}/><span>Search</span></button>
      <button className={tab==="library"?"active":""} onClick={()=>changeTab("library")}><Library size={22}/><span>Your Library</span></button>
    </nav>
    <audio ref={audio} preload="metadata" playsInline onLoadedMetadata={e=>{const d=Number.isFinite(e.currentTarget.duration)?e.currentTarget.duration:0;setDuration(d);try{const saved=sessionStorage.getItem("spotified-playback");if(saved){const item=JSON.parse(saved);if(item.track?.id===playing&&Number(item.position)>0&&Number(item.position)<d)e.currentTarget.currentTime=Number(item.position);}}catch{/* Ignore saved playback errors. */}}} onTimeUpdate={e=>{const position=e.currentTarget.currentTime;setCurrentTime(position);try{const saved=sessionStorage.getItem("spotified-playback");if(saved){const item=JSON.parse(saved);sessionStorage.setItem("spotified-playback",JSON.stringify({...item,position}));}}catch{/* Ignore storage errors. */}}} onPlay={()=>setIsPlaying(true)} onPause={()=>setIsPlaying(false)} onError={()=>{if(playing)setMessage("The audio host rejected this file or the format is unsupported. Try another result or Open audio in Safari/Chrome.");setIsPlaying(false);}} onEnded={()=>{
      if(repeat&&audio.current){audio.current.currentTime=0;void audio.current.play();return;}
      skip(1);
    }}/>
  </main>;
}

function TrackList({tracks,playing,liked,onPlay,onLike,onAdd}:{tracks:Track[];playing:string;liked:string[];onPlay:(t:Track)=>void;onLike:(t:Track)=>void;onAdd:(t:Track)=>void}){
  return <div className="track-list">{tracks.map((t,i)=><div className="track-row" key={t.id}><button className="track-art" onClick={()=>onPlay(t)} aria-label={"Play "+t.title}>{t.artwork?<img src={t.artwork} alt="" />:playing===t.id?<Pause size={17}/>:<Music2 size={18}/>}</button><button className="track-name" onClick={()=>onPlay(t)}><b>{t.title}</b><span>{t.artist??(t.source==="catalog"?(t.provider||"Music catalogue"):"Your upload")}{t.provider?" · "+t.provider:""}</span></button>{t.source==="catalog"&&<button className="like" onClick={()=>window.open(t.externalUrl||t.url,"_blank","noopener,noreferrer")} aria-label="Open source page"><ExternalLink size={16}/></button>}{t.downloadable&&<button className="like" onClick={()=>window.open(t.url,"_blank","noopener,noreferrer")} aria-label="Open licensed audio download"><Download size={16}/></button>}<button className="like" onClick={()=>onAdd(t)} aria-label="Add to playlist"><ListMusic size={17}/></button><button className={"like "+(liked.includes(t.id)?"liked":"")} onClick={()=>onLike(t)} aria-label="Like track"><Heart size={18} fill={liked.includes(t.id)?"currentColor":"none"}/></button><span className="track-index">{i+1}</span></div>)}</div>;
}
function time(v:number){if(!Number.isFinite(v)||v<0)return "0:00";return Math.floor(v/60)+":"+String(Math.floor(v%60)).padStart(2,"0");}
