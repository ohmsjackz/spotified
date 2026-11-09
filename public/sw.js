const CACHE_NAME="spotified-shell-v1";
const CORE=["/","/manifest.json"];
self.addEventListener("install",event=>{
  event.waitUntil((async()=>{
    const cache=await caches.open(CACHE_NAME);
    await Promise.all(CORE.map(async path=>{try{await cache.add(path);}catch{}}));
    await self.skipWaiting();
  })());
});
self.addEventListener("activate",event=>{
  event.waitUntil((async()=>{
    const keys=await caches.keys();
    await Promise.all(keys.filter(key=>key.startsWith("spotified-shell-")&&key!==CACHE_NAME).map(key=>caches.delete(key)));
    await self.clients.claim();
  })());
});
self.addEventListener("fetch",event=>{
  const request=event.request;
  if(request.method!=="GET")return;
  const url=new URL(request.url);
  if(url.origin!==self.location.origin||url.pathname.startsWith("/api/"))return;
  if(request.mode==="navigate"){
    event.respondWith((async()=>{
      try{
        const response=await fetch(request);
        if(response.ok){const cache=await caches.open(CACHE_NAME);await cache.put("/",response.clone());}
        return response;
      }catch{
        return (await caches.match(request))||(await caches.match("/"))||new Response("You are offline. Open Spotified again when connected once to cache the app shell.",{status:503,headers:{"Content-Type":"text/plain"}});
      }
    })());
    return;
  }
  if(url.pathname.startsWith("/_next/static/")||url.pathname==="/manifest.json"){
    event.respondWith((async()=>{
      const cached=await caches.match(request);
      if(cached)return cached;
      try{
        const response=await fetch(request);
        if(response.ok){const cache=await caches.open(CACHE_NAME);await cache.put(request,response.clone());}
        return response;
      }catch{return cached||Response.error();}
    })());
  }
});
