let preferredLanguage;
try {
  const saved = localStorage.getItem('playload-language');
  if (['ja', 'en'].includes(saved)) preferredLanguage = saved;
} catch {
  // Browser language still works when storage is unavailable.
}

function setLanguage() {
  const languages = navigator.languages?.length ? navigator.languages : [navigator.language];
  document.documentElement.lang =
    preferredLanguage ||
    languages
      .map((language) => language.toLowerCase().split('-')[0])
      .find((language) => ['ja', 'en'].includes(language)) ||
    'en';
  for (const button of document.querySelectorAll('.language-switch button'))
    button.setAttribute('aria-pressed', button.dataset.language === document.documentElement.lang);
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
  setLanguage();
  for (const button of document.querySelectorAll('.language-switch button')) {
    button.addEventListener('click', () => {
      preferredLanguage = button.dataset.language;
      try {
        localStorage.setItem('playload-language', preferredLanguage);
      } catch {
        // Keep the current choice even if the browser cannot save it.
      }
      setLanguage();
    });
  }
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
