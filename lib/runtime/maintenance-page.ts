/** The branded page served (HTTP 503) while maintenance mode is on. A plain HTML string built with no imports, session or database
 * reads, so middleware can return it directly even while the database is being restored. Large type on purpose: it must be
 * readable at a glance on a phone. Colors match the IDOC midnight/gold palette in app/globals.css. */
export function maintenancePageHtml(): string {
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow"><title>IDOC | Back soon</title>
<style>
html,body{margin:0;min-height:100%}
body{display:flex;min-height:100vh;flex-direction:column;align-items:center;justify-content:center;gap:2.5rem;padding:4rem 1.5rem;box-sizing:border-box;text-align:center;
background:linear-gradient(180deg,#0f1838 0%,#1a2656 100%);color:#f2f4fa;font-family:'Barlow',-apple-system,'Segoe UI',Roboto,Helvetica,Arial,sans-serif}
img{height:5rem;width:auto}
.kicker{margin:0;color:#d3af37;font-size:1.25rem;font-weight:600;letter-spacing:.3em;text-transform:uppercase}
h1{margin:1rem 0 1.5rem;font-size:3rem;line-height:1.1;font-weight:600}
p.msg{margin:0 auto;max-width:56rem;color:#b9bfd3;font-size:1.5rem;line-height:1.5}
.wrap{max-width:64rem}
@media(min-width:640px){img{height:7rem}.kicker{font-size:1.5rem}h1{font-size:4.5rem}p.msg{font-size:2.25rem}}
</style></head>
<body><img src="/idoc-logo-white.svg" alt="International Dressage Officials Club" width="280" height="112">
<main class="wrap"><p class="kicker">Scheduled maintenance</p><h1>We&rsquo;ll be right back</h1>
<p class="msg">IDOC is being updated. Your membership and information are safe. Please check back shortly.</p></main></body></html>`;
}
