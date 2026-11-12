// Firebase cannot redirect only the default *.web.app domain, so do it here.
// Runs before the app; keeps path, query and hash.
(function () {
  var h = location.hostname;
  if (h === 'ghlearn-f31c9.web.app' || h === 'ghlearn-f31c9.firebaseapp.com') {
    location.replace('https://ghlearn.com' + location.pathname + location.search + location.hash);
  }
})();
