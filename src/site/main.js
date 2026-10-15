function setLanguage() {
  const languages = navigator.languages?.length ? navigator.languages : [navigator.language];
  document.documentElement.lang =
    languages
      .map((language) => language.toLowerCase().split('-')[0])
      .find((language) => ['ja', 'en'].includes(language)) || 'en';
}
setLanguage();
window.addEventListener('languagechange', setLanguage);

function openSharedGame() {
  if (!/^#(?:v1|1)\./.test(location.hash)) return;
  const app = new URL('app/', location.href);
  app.search = location.search;
  app.hash = location.hash;
  location.replace(app.href);
}
openSharedGame();
window.addEventListener('hashchange', openSharedGame);
