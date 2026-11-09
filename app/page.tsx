"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AudioLines, House, Search, Library, Plus, Play, Pause, UploadCloud,
  LogIn, LogOut, Music2, Sparkles, ChevronRight, X, Check, LoaderCircle
} from "lucide-react";
import { supabase } from "@/lib/supabase";

type Track = { id: string; title: string; url: string; storagePath?: string; createdAt?: string };
type Tab = "home" | "search" | "library";

export default function Home() {
  const [tab, setTab] = useState<Tab>("home");
  const [email, setEmail] = useState("");
  const [user, setUser] = useState<any>(null);
  const [tracks, setTracks] = useState<Track[]>([]);
  const [query, setQuery] = useState("");
  const [playing, setPlaying] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [showSignIn, setShowSignIn] = useState(false);
  const [sent, setSent] = useState(false);
  const audioRef = useRef<HTMLAudioElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const loadTracks = useCallback(async (uid: string) => {
    if (!supabase) return;
    const { data, error } = await supabase.from("uploaded_tracks")
      .select("id,title,storage_path,created_at").eq("user_id", uid).order("created_at", { ascending: false });
    if (error) { setMessage(error.message); return; }
    const restored = await Promise.all((data ?? []).map(async (row: any) => {
      const { data: signed } = await supabase!.storage.from("user-audio").createSignedUrl(row.storage_path, 3600);
      return signed?.signedUrl ? { id: row.id, title: row.title, url: signed.signedUrl, storagePath: row.storage_path, createdAt: row.created_at } : null;
    }));
    setTracks(restored.filter(Boolean) as Track[]);
  }, []);

  useEffect(() => {
    if (!supabase) return;
    let alive = true;
    supabase.auth.getSession().then(({ data }) => {
      if (!alive) return;
      const current = data.session?.user ?? null;
      setUser(current);
      if (current) void loadTracks(current.id);
    });
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      const current = session?.user ?? null;
      setUser(current);
      if (current) void loadTracks(current.id);
      else { setTracks([]); setPlaying(""); }
      if (session) { setShowSignIn(false); setSent(false); setMessage("You're signed in."); }
    });
    return () => { alive = false; subscription.unsubscribe(); };
  }, [loadTracks]);

  async function sendMagicLink() {
    if (!supabase) { setMessage("Sign-in is temporarily unavailable. Please try again later."); return; }
    const clean = email.trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(clean)) { setMessage("Enter a valid email address."); return; }
    setBusy(true); setMessage("");
    const { error } = await supabase.auth.signInWithOtp({
      email: clean,
      options: { emailRedirectTo: window.location.origin, shouldCreateUser: true }
    });
    setBusy(false);
    if (error) { setMessage(error.message); return; }
    setSent(true);
    setMessage("Sign-in link sent. Open the email on this device, then return here.");
  }

  async function uploadAudio(file?: File) {
    if (!file || !supabase || !user) return;
    if (!file.type.startsWith("audio/")) { setMessage("Choose an audio file."); return; }
    if (file.size > 50 * 1024 * 1024) { setMessage("Files must be 50 MB or smaller."); return; }
    setBusy(true); setMessage("");
    const path = user.id + "/" + Date.now() + "-" + file.name.replace(/[^a-zA-Z0-9._-]/g, "_");
    const { error: uploadError } = await supabase.storage.from("user-audio").upload(path, file);
    if (uploadError) { setBusy(false); setMessage(uploadError.message); return; }
    const { data: row, error: rowError } = await supabase.from("uploaded_tracks")
      .insert({ user_id: user.id, storage_path: path, title: file.name.replace(/\.[^.]+$/, "") })
      .select("id,title,storage_path,created_at").single();
    if (rowError) { setBusy(false); setMessage(rowError.message); return; }
    const { data: signed } = await supabase.storage.from("user-audio").createSignedUrl(path, 3600);
    if (signed?.signedUrl) setTracks(current => [{ id: row.id, title: row.title, url: signed.signedUrl, storagePath: path, createdAt: row.created_at }, ...current]);
    setBusy(false); setMessage("Added to your library.");
    if (fileRef.current) fileRef.current.value = "";
  }

  function playTrack(track: Track) {
    const audio = audioRef.current;
    if (!audio) return;
    if (playing === track.id) { audio.pause(); setPlaying(""); return; }
    audio.src = track.url;
    void audio.play().then(() => setPlaying(track.id)).catch(() => setMessage("Couldn't play this file. Try uploading it again."));
  }

  async function signOut() {
    if (!supabase) return;
    await supabase.auth.signOut();
    setMessage("Signed out.");
  }

  const filtered = useMemo(() => tracks.filter(t => t.title.toLowerCase().includes(query.toLowerCase())), [tracks, query]);
  const currentTrack = tracks.find(t => t.id === playing);

  return (
    <main className="app-shell">
      <aside className="sidebar glass">
        <a className="brand" href="#" onClick={e => { e.preventDefault(); setTab("home"); }}>
          <span className="brand-mark"><AudioLines size={22}/></span><span>spotified</span>
        </a>
        <div className="nav-label">MENU</div>
        <nav className="side-nav">
          <button className={tab === "home" ? "active" : ""} onClick={() => setTab("home")}><House/><span>Home</span></button>
          <button className={tab === "search" ? "active" : ""} onClick={() => setTab("search")}><Search/><span>Search</span></button>
          <button className={tab === "library" ? "active" : ""} onClick={() => setTab("library")}><Library/><span>Your Library</span></button>
        </nav>
        <div className="sidebar-bottom">
          <div className="sidebar-note"><Sparkles size={16}/><span>Your sound, your space.</span></div>
          {user ? <button className="account-button" onClick={signOut}><LogOut size={17}/> Sign out</button> : <button className="account-button" onClick={() => setShowSignIn(true)}><LogIn size={17}/> Sign in</button>}
        </div>
      </aside>

      <section className="content-area">
        <header className="topbar">
          <div className="topbar-greeting"><span className="eyebrow">YOUR PERSONAL MUSIC SPACE</span><strong>{user ? "Welcome back" : "Made for your moments"}</strong></div>
          <div className="top-actions">
            {user ? <div className="user-pill"><span className="online-dot"/>{user.email}</div> : <button className="button button-soft" onClick={() => setShowSignIn(true)}><LogIn size={16}/> Sign in</button>}
          </div>
        </header>

        {tab === "home" && <div className="page-view">
          <section className="welcome-card">
            <div className="welcome-orb orb-one"/><div className="welcome-orb orb-two"/>
            <div className="welcome-copy"><span className="eyebrow">A LITTLE MORE YOU</span><h1>Every day has<br/><em>its own rhythm.</em></h1><p>Bring your own music into one calm, personal library.</p>
              <div className="welcome-actions"><button className="button button-primary" onClick={() => user ? fileRef.current?.click() : setShowSignIn(true)}>{user ? <><Plus size={17}/> Add music</> : <><LogIn size={17}/> Get started</>}</button><button className="button button-glass" onClick={() => setTab("search")}><Search size={17}/> Explore library</button></div>
            </div><div className="hero-art"><div className="vinyl"><div className="vinyl-center"><AudioLines size={30}/></div></div><div className="floating-chip"><Sparkles size={15}/> your soundtrack</div></div>
          </section>
          <section className="section-block">
            <div className="section-heading"><div><span className="eyebrow">PICK UP WHERE YOU LEFT OFF</span><h2>Recently added</h2></div><button className="text-action" onClick={() => setTab("library")}>See all <ChevronRight size={16}/></button></div>
            {!user ? <div className="empty-card"><div className="empty-icon"><Music2 size={25}/></div><div><h3>Your library is waiting</h3><p>Sign in to save and play audio you own or have permission to use.</p></div><button className="button button-soft" onClick={() => setShowSignIn(true)}>Sign in with email</button></div> : tracks.length === 0 ? <div className="empty-card"><div className="empty-icon"><UploadCloud size={25}/></div><div><h3>Start with a track of your own</h3><p>Upload an audio file up to 50 MB. It will be saved to your private library.</p></div><button className="button button-soft" onClick={() => fileRef.current?.click()}>Upload audio</button></div> : <TrackList tracks={tracks.slice(0,4)} playing={playing} onPlay={playTrack}/>}
          </section>
        </div>}

        {tab === "search" && <div className="page-view">
          <div className="page-title"><span className="eyebrow">FIND YOUR SOUND</span><h1>Search</h1><p>Find a track in your personal library.</p></div>
          <div className="search-box glass"><Search size={20}/><input value={query} onChange={e => setQuery(e.target.value)} placeholder="Search your tracks..." autoComplete="off"/>{query && <button onClick={() => setQuery("")} aria-label="Clear search"><X size={17}/></button>}</div>
          {user ? <><div className="section-heading search-results-heading"><h2>{query ? "Results" : "Your music"}</h2><span className="result-count">{filtered.length} {filtered.length === 1 ? "track" : "tracks"}</span></div>{filtered.length ? <TrackList tracks={filtered} playing={playing} onPlay={playTrack}/> : <div className="empty-card"><div className="empty-icon"><Search size={24}/></div><div><h3>No tracks found</h3><p>Try another title or upload something new.</p></div></div>}</> : <div className="empty-card"><div className="empty-icon"><LogIn size={24}/></div><div><h3>Sign in to search your music</h3><p>Your private library appears here after you sign in.</p></div><button className="button button-soft" onClick={() => setShowSignIn(true)}>Sign in</button></div>}
        </div>}

        {tab === "library" && <div className="page-view">
          <div className="page-title library-title"><div><span className="eyebrow">ALL YOUR FAVORITES</span><h1>Your Library</h1><p>{user ? tracks.length + (tracks.length === 1 ? " track" : " tracks") : "A home for your music."}</p></div>{user && <button className="button button-primary" onClick={() => fileRef.current?.click()}><Plus size={17}/> Add music</button>}</div>
          {!user ? <div className="empty-card"><div className="empty-icon"><Library size={24}/></div><div><h3>Your music, together</h3><p>Sign in with your email to access your private library.</p></div><button className="button button-soft" onClick={() => setShowSignIn(true)}>Sign in</button></div> : tracks.length ? <TrackList tracks={tracks} playing={playing} onPlay={playTrack}/> : <div className="empty-card"><div className="empty-icon"><Music2 size={24}/></div><div><h3>Nothing here just yet</h3><p>Add your first audio file and it will show up here.</p></div><button className="button button-soft" onClick={() => fileRef.current?.click()}>Upload audio</button></div>}
        </div>}

        <input ref={fileRef} className="hidden-input" type="file" accept="audio/*" onChange={e => void uploadAudio(e.target.files?.[0])}/>
        {message && <div className="toast" role="status"><span>{message}</span><button onClick={() => setMessage("")} aria-label="Dismiss"><X size={15}/></button></div>}
      </section>

      <nav className="mobile-nav glass" aria-label="Main navigation">
        <button className={tab === "home" ? "active" : ""} onClick={() => setTab("home")}><House/><span>Home</span></button>
        <button className={tab === "search" ? "active" : ""} onClick={() => setTab("search")}><Search/><span>Search</span></button>
        <button className={tab === "library" ? "active" : ""} onClick={() => setTab("library")}><Library/><span>Library</span></button>
      </nav>

      {currentTrack && <div className="mini-player glass"><div className="mini-cover"><AudioLines size={19}/></div><div className="mini-meta"><strong>{currentTrack.title}</strong><span>Playing from your library</span></div><button className="play-button" onClick={() => playTrack(currentTrack)} aria-label="Pause"><Pause size={19}/></button></div>}
      <audio ref={audioRef} onEnded={() => setPlaying("")} onPause={() => {}} className="audio-element"/>

      {showSignIn && <div className="modal-backdrop" onClick={() => setShowSignIn(false)}>
        <section className="signin-modal glass" role="dialog" aria-modal="true" aria-labelledby="signin-title" onClick={e => e.stopPropagation()}>
          <button className="modal-close" onClick={() => {setShowSignIn(false);setSent(false);}} aria-label="Close"><X size={19}/></button>
          <div className="modal-logo"><AudioLines size={25}/></div>
          {!sent ? <><span className="eyebrow">WELCOME TO SPOTIFIED</span><h2 id="signin-title">Your music.<br/><em>Your space.</em></h2><p>Enter your email and we’ll send you a secure sign-in link. No password or Google account needed.</p><form onSubmit={e => {e.preventDefault(); void sendMagicLink();}}><label htmlFor="email">Email address</label><input id="email" type="email" inputMode="email" autoComplete="email" placeholder="you@example.com" value={email} onChange={e => setEmail(e.target.value)} required/><button className="button button-primary modal-submit" disabled={busy}>{busy ? <><LoaderCircle className="spin" size={17}/> Sending…</> : <>Continue with email <ChevronRight size={17}/></>}</button></form></> : <div className="sent-state"><div className="sent-icon"><Check size={25}/></div><span className="eyebrow">CHECK YOUR INBOX</span><h2>Link on its way.</h2><p>We sent a sign-in link to <strong>{email}</strong>. Open it in this browser to finish signing in.</p><button className="button button-soft modal-submit" onClick={() => {setSent(false);setMessage("");}}>Use a different email</button></div>}
          {message && <div className="modal-message" role="status">{message}</div>}
          <small className="privacy-note">By continuing, you agree to use only music you own or are licensed to play.</small>
        </section>
      </div>}
    </main>
  );
}

function TrackList({ tracks, playing, onPlay }: { tracks: Track[]; playing: string; onPlay: (track: Track) => void }) {
  return <div className="track-list">{tracks.map((track, index) => <div className="track-row" key={track.id}><span className="track-index">{String(index + 1).padStart(2, "0")}</span><div className="track-art"><Music2 size={18}/></div><div className="track-info"><strong>{track.title}</strong><span>Personal library</span></div><button className="track-play" onClick={() => onPlay(track)} aria-label={playing === track.id ? "Pause " + track.title : "Play " + track.title}>{playing === track.id ? <Pause size={18}/> : <Play size={18}/>}</button></div>)}</div>;
}
