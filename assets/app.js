// 作品カテゴリフィルター
const tabs = document.querySelectorAll('#filter-tabs .ftab');
const cards = document.querySelectorAll('.work-card');

tabs.forEach((btn) => {
  btn.addEventListener('click', () => {
    tabs.forEach((b) => b.classList.remove('active'));
    btn.classList.add('active');
    const f = btn.dataset.filter;
    cards.forEach((c) => {
      const show = f === 'all' || c.dataset.cat === f;
      c.classList.toggle('hidden', !show);
    });
  });
});
