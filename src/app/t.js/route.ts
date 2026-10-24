// Script de suivi à poser sur le site : <script async src="https://<domaine du tableau de bord>/t.js"></script>
// Sans cookie ni identifiant stocké : il envoie l'adresse de la page et le référent, une fois par page vue.
export function GET(request: Request) {
  const point = new URL("/api/visite", request.url).toString();
  const code = `(function(){try{var d=JSON.stringify({page:location.href,ref:document.referrer||null});` +
    `if(navigator.sendBeacon){navigator.sendBeacon(${JSON.stringify(point)},new Blob([d],{type:"text/plain"}));}` +
    `else{fetch(${JSON.stringify(point)},{method:"POST",body:d,keepalive:true,headers:{"content-type":"text/plain"}});}}catch(e){}})();`;
  return new Response(code, {
    headers: { "content-type": "application/javascript; charset=utf-8", "cache-control": "public, max-age=3600" },
  });
}
