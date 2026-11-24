// 作品カテゴリフィルター & ワイドカード最適化
const tabs = document.querySelectorAll('#filter-tabs .ftab');
const cards = Array.from(document.querySelectorAll('.work-card'));

function applyFilter(filter) {
  const visible = [];
  cards.forEach((c) => {
    const show = filter === 'all' || c.dataset.cat === filter;
    c.classList.toggle('hidden', !show);
    c.classList.remove('is-featured');
    if (show) visible.push(c);
  });

  // 表示枚数が奇数のときは先頭カードを横長ワイド表示にして空白スロットをなくす
  if (visible.length === 1 || (visible.length > 2 && visible.length % 2 === 1)) {
    visible[0].classList.add('is-featured');
  }
}

tabs.forEach((btn) => {
  btn.addEventListener('click', () => {
    tabs.forEach((b) => b.classList.remove('active'));
    btn.classList.add('active');
    applyFilter(btn.dataset.filter);
  });
});

applyFilter('all');
