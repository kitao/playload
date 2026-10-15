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

document.addEventListener('DOMContentLoaded', () => {
  const preview = document.querySelector('#image-preview');
  const enlarged = preview.querySelector('img');
  const close = preview.querySelector('button');
  for (const link of document.querySelectorAll('.readme a:has(> img)')) {
    link.setAttribute('aria-haspopup', 'dialog');
    link.addEventListener('click', (event) => {
      if (event.button || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      event.preventDefault();
      enlarged.src = link.href;
      enlarged.alt = link.querySelector('img').alt;
      preview.setAttribute('aria-label', enlarged.alt);
      close.setAttribute(
        'aria-label',
        document.documentElement.lang === 'ja' ? '画像を閉じる' : 'Close image',
      );
      preview.showModal();
    });
  }
  preview.addEventListener('click', () => preview.close());
});
