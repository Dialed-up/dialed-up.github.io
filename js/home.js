// Public home pages: home.html?u=screenname
import "./guard.js";
import { auth, onAuthStateChanged } from "./firebase.js";
import { showPublicPage } from "./homepage.js";
const key = (new URLSearchParams(location.search).get("u") || "").toLowerCase().replace(/[^a-z0-9]/g, "");
if (!key) document.getElementById("page").innerHTML = '<div class="panel">No page picked. Try a link like home.html?u=screenname</div>';
else showPublicPage(key, document.getElementById("page"), document.getElementById("guestbook"));
onAuthStateChanged(auth, (u) => {
  const f = document.getElementById("gb-form");
  f.querySelector("button").disabled = !u;
  document.getElementById("gb-hint").innerHTML = u ? "" : 'Sign on to DialedUp to sign the guestbook.';
});
