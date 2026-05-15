const state = {
  bangs: [],
  categories: [],
  filtered: [],
  activeCategory: 'all',
  searchTerm: '',
  sortBy: 'popularity',
  previewTerm: 'privacy tools',
  selectedId: null
};

const elements = {
  categorySelect: document.querySelector('#category-select'),
  detailAliases: document.querySelector('#detail-aliases'),
  detailCategory: document.querySelector('#detail-category'),
  detailName: document.querySelector('#detail-name'),
  detailPopularity: document.querySelector('#detail-popularity'),
  detailPreviewLink: document.querySelector('#detail-preview-link'),
  detailPrimary: document.querySelector('#detail-primary'),
  detailSummary: document.querySelector('#detail-summary'),
  detailTemplate: document.querySelector('#detail-template'),
  focusSearch: document.querySelector('#focus-search'),
  previewInput: document.querySelector('#preview-input'),
  quickFilters: document.querySelector('#quick-filters'),
  resetFilters: document.querySelector('#reset-filters'),
  resultsContext: document.querySelector('#results-context'),
  resultsCount: document.querySelector('#results-count'),
  resultsList: document.querySelector('#results-list'),
  resultTemplate: document.querySelector('#result-template'),
  searchInput: document.querySelector('#search-input'),
  sortSelect: document.querySelector('#sort-select'),
  statCategories: document.querySelector('#stat-categories'),
  statTotal: document.querySelector('#stat-total')
};

const numberFormatter = new Intl.NumberFormat('en-US');

function slugify(value) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '-');
}

function normalizeBang([rawAliases, name, categoryIndex, popularity, template], index) {
  const aliases = Array.isArray(rawAliases) ? rawAliases : [rawAliases];
  const primaryAlias = aliases[0] ?? '';
  const category = state.categories[categoryIndex] ?? 'Uncategorized';

  return {
    id: `${slugify(name)}-${index}`,
    aliases,
    name,
    category,
    categoryIndex,
    popularity,
    template,
    primaryAlias,
    searchable: [name, category, template, ...aliases].join(' ').toLowerCase()
  };
}

function buildPreviewUrl(template, previewTerm) {
  return template.replaceAll('%s', encodeURIComponent(previewTerm.trim() || 'search'));
}

function buildQuickFilters() {
  const labels = ['all', ...state.categories];

  elements.quickFilters.innerHTML = '';

  for (const label of labels) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = `chip${label === state.activeCategory ? ' active' : ''}`;
    button.textContent = label === 'all' ? 'All categories' : label;
    button.addEventListener('click', () => {
      state.activeCategory = label;
      elements.categorySelect.value = label;
      syncAndRender();
    });
    elements.quickFilters.append(button);
  }
}

function populateCategorySelect() {
  for (const category of state.categories) {
    const option = document.createElement('option');
    option.value = category;
    option.textContent = category;
    elements.categorySelect.append(option);
  }
}

function scoreBang(bang) {
  const term = state.searchTerm.trim().toLowerCase();
  if (!term) {
    return bang.popularity;
  }

  let score = bang.popularity / 1000;

  if (bang.primaryAlias.toLowerCase() === term) {
    score += 100000;
  }
  if (bang.aliases.some(alias => alias.toLowerCase() === term)) {
    score += 50000;
  }
  if (bang.name.toLowerCase() === term) {
    score += 25000;
  }
  if (bang.name.toLowerCase().includes(term)) {
    score += 4000;
  }
  if (bang.aliases.some(alias => alias.toLowerCase().includes(term))) {
    score += 3000;
  }
  if (bang.template.toLowerCase().includes(term)) {
    score += 800;
  }
  if (bang.category.toLowerCase().includes(term)) {
    score += 400;
  }

  return score;
}

function sortBangs(items) {
  const sorted = [...items];

  sorted.sort((left, right) => {
    if (state.sortBy === 'name') {
      return left.name.localeCompare(right.name);
    }

    if (state.sortBy === 'aliasCount') {
      return right.aliases.length - left.aliases.length || right.popularity - left.popularity;
    }

    return scoreBang(right) - scoreBang(left);
  });

  return sorted;
}

function filterBangs() {
  const term = state.searchTerm.trim().toLowerCase();

  const filtered = state.bangs.filter(bang => {
    const matchesCategory =
      state.activeCategory === 'all' || bang.category === state.activeCategory;
    const matchesTerm = !term || bang.searchable.includes(term);
    return matchesCategory && matchesTerm;
  });

  state.filtered = sortBangs(filtered).slice(0, 120);

  if (!state.filtered.some(bang => bang.id === state.selectedId)) {
    state.selectedId = state.filtered[0]?.id ?? null;
  }
}

function copyBang(alias) {
  navigator.clipboard.writeText(`!${alias}`).catch(() => undefined);
}

function renderResults() {
  elements.resultsList.innerHTML = '';
  const fragment = document.createDocumentFragment();

  if (state.filtered.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'empty-state';
    empty.textContent = 'No bangs matched that search. Try a shorter term or reset filters.';
    elements.resultsList.append(empty);
    renderDetail();
    return;
  }

  for (const bang of state.filtered) {
    const template = elements.resultTemplate.content.cloneNode(true);
    const card = template.querySelector('.result-card');
    const name = template.querySelector('.result-name');
    const url = template.querySelector('.result-url');
    const category = template.querySelector('.result-category');
    const popularity = template.querySelector('.result-popularity');
    const aliasCount = template.querySelector('.result-alias-count');
    const aliases = template.querySelector('.result-aliases');
    const copyButton = template.querySelector('.copy-button');

    card.dataset.id = bang.id;
    if (bang.id === state.selectedId) {
      card.classList.add('is-selected');
    }

    name.textContent = bang.name;
    url.textContent = bang.template;
    category.textContent = bang.category;
    popularity.textContent = `${numberFormatter.format(bang.popularity)} uses`;
    aliasCount.textContent = `${bang.aliases.length} alias${bang.aliases.length === 1 ? '' : 'es'}`;

    for (const alias of bang.aliases.slice(0, 8)) {
      const chip = document.createElement('span');
      chip.className = 'alias';
      chip.textContent = `!${alias}`;
      aliases.append(chip);
    }

    if (bang.aliases.length > 8) {
      const chip = document.createElement('span');
      chip.className = 'alias';
      chip.textContent = `+${bang.aliases.length - 8} more`;
      aliases.append(chip);
    }

    card.addEventListener('click', () => {
      state.selectedId = bang.id;
      renderResults();
      renderDetail();
    });

    copyButton.addEventListener('click', event => {
      event.stopPropagation();
      copyBang(bang.primaryAlias);
      copyButton.textContent = 'Copied';
      window.setTimeout(() => {
        copyButton.textContent = 'Copy bang';
      }, 1200);
    });

    fragment.append(card);
  }

  elements.resultsList.append(fragment);
  renderDetail();
}

function renderDetail() {
  const selected = state.filtered.find(bang => bang.id === state.selectedId);

  if (!selected) {
    elements.detailName.textContent = 'Choose a bang';
    elements.detailSummary.textContent = 'No result is selected.';
    elements.detailPrimary.textContent = '-';
    elements.detailCategory.textContent = '-';
    elements.detailPopularity.textContent = '-';
    elements.detailAliases.innerHTML = '';
    elements.detailTemplate.textContent = '-';
    elements.detailPreviewLink.textContent = 'Open preview';
    elements.detailPreviewLink.href = '#';
    return;
  }

  elements.detailName.textContent = selected.name;
  elements.detailSummary.textContent = `Use !${selected.primaryAlias} to route a search toward ${selected.name}.`;
  elements.detailPrimary.textContent = `!${selected.primaryAlias}`;
  elements.detailCategory.textContent = selected.category;
  elements.detailPopularity.textContent = numberFormatter.format(selected.popularity);
  elements.detailTemplate.textContent = selected.template;
  elements.detailAliases.innerHTML = '';

  for (const alias of selected.aliases) {
    const item = document.createElement('span');
    item.className = 'alias';
    item.textContent = `!${alias}`;
    elements.detailAliases.append(item);
  }

  const previewUrl = buildPreviewUrl(selected.template, state.previewTerm);
  elements.detailPreviewLink.href = previewUrl;
  elements.detailPreviewLink.textContent = previewUrl;
}

function updateMeta() {
  elements.resultsCount.textContent = `${numberFormatter.format(state.filtered.length)} results`;
  elements.resultsContext.textContent = state.searchTerm
    ? `Matching "${state.searchTerm}"${state.activeCategory === 'all' ? '' : ` in ${state.activeCategory}`}.`
    : `Showing ${state.activeCategory === 'all' ? 'all categories' : state.activeCategory}.`;
}

function syncAndRender() {
  buildQuickFilters();
  filterBangs();
  updateMeta();
  renderResults();
}

function wireEvents() {
  elements.searchInput.addEventListener('input', event => {
    state.searchTerm = event.target.value;
    syncAndRender();
  });

  elements.categorySelect.addEventListener('change', event => {
    state.activeCategory = event.target.value;
    syncAndRender();
  });

  elements.sortSelect.addEventListener('change', event => {
    state.sortBy = event.target.value;
    syncAndRender();
  });

  elements.previewInput.addEventListener('input', event => {
    state.previewTerm = event.target.value;
    renderDetail();
  });

  elements.resetFilters.addEventListener('click', () => {
    state.activeCategory = 'all';
    state.searchTerm = '';
    state.sortBy = 'popularity';
    state.previewTerm = 'privacy tools';
    elements.categorySelect.value = 'all';
    elements.searchInput.value = '';
    elements.sortSelect.value = 'popularity';
    elements.previewInput.value = state.previewTerm;
    syncAndRender();
  });

  elements.focusSearch.addEventListener('click', () => {
    elements.searchInput.focus();
    elements.searchInput.scrollIntoView({ behavior: 'smooth', block: 'center' });
  });
}

function revealOnScroll() {
  const observer = new IntersectionObserver(
    entries => {
      for (const entry of entries) {
        if (entry.isIntersecting) {
          entry.target.classList.add('is-visible');
          observer.unobserve(entry.target);
        }
      }
    },
    { threshold: 0.15 }
  );

  for (const element of document.querySelectorAll('.reveal')) {
    observer.observe(element);
  }
}

async function bootstrap() {
  const response = await fetch('./data/bangs.json');

  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }

  const data = await response.json();

  state.categories = data.c;
  state.bangs = data.b.map(normalizeBang);
  state.filtered = state.bangs;
  state.selectedId = state.bangs[0]?.id ?? null;

  elements.statTotal.textContent = `${numberFormatter.format(state.bangs.length)} bangs`;
  elements.statCategories.textContent = `${numberFormatter.format(state.categories.length)} groups`;

  populateCategorySelect();
  buildQuickFilters();
  wireEvents();
  revealOnScroll();
  syncAndRender();
}

bootstrap().catch(error => {
  elements.resultsList.innerHTML = `<div class="empty-state">Could not load bangs data. ${error.message}. Serve the site over HTTP so the browser can read <code>data/bangs.json</code>.</div>`;
});
