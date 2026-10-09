'use strict';

const CATEGORIES = ['Appetizers & Snacks', 'Mains', 'Sides', 'Soups & Stews', 'Desserts', 'Drinks'];
const $ = id => document.getElementById(id);
let recipes = [];
let currentId = null;
let editingId = null;
let selectedPhoto = '';
let busy = false;

function notice(message) {
  $('notice').textContent = message;
  $('notice').hidden = !message;
}

function configured() {
  return CONFIG.API_URL.startsWith('https://script.google.com/macros/s/') &&
    CONFIG.SECRET !== 'PASTE_YOUR_SECRET_HERE';
}

// JSONP for reading: Apps Script web apps do not reliably support browser CORS.
function readCloud() {
  return new Promise((resolve, reject) => {
    const callback = '__cookbookCallback' + Date.now();
    const script = document.createElement('script');
    const timeout = setTimeout(() => finish(new Error('Connection timed out')), 20000);
    function finish(error, data) {
      clearTimeout(timeout);
      delete window[callback];
      script.remove();
      if (error) reject(error);
      else resolve(data);
    }
    window[callback] = data => finish(null, data);
    script.onerror = () => finish(new Error('Cannot reach Apps Script'));
    script.src = CONFIG.API_URL + '?action=list&secret=' + encodeURIComponent(CONFIG.SECRET) +
      '&callback=' + callback + '&t=' + Date.now();
    document.head.appendChild(script);
  });
}

// Google Apps Script accepts simple POSTs, but the browser cannot reliably read
// the redirected response. We verify writes by re-reading the spreadsheet.
async function postCloud(payload) {
  await fetch(CONFIG.API_URL, {
    method: 'POST',
    mode: 'no-cors',
    headers: { 'Content-Type': 'text/plain;charset=utf-8' },
    body: JSON.stringify({ ...payload, secret: CONFIG.SECRET })
  });
}

async function refresh(silent = false) {
  if (!configured()) {
    notice('Set up config.js and Google Apps Script to enable cloud sync.');
    return;
  }
  try {
    if (!silent) notice('Syncing…');
    const result = await readCloud();
    if (!result.ok) throw new Error(result.error || 'Sync failed');
    recipes = result.recipes || [];
    renderHome();
    if (currentId && !$('detailView').hidden) renderDetail();
    if (!silent) notice('');
  } catch (error) {
    notice('Sync error: ' + error.message);
  }
}

async function writeAndVerify(payload, verify) {
  if (busy) return false;
  busy = true;
  $('saveBtn').disabled = true;
  notice('Saving…');
  try {
    await postCloud(payload);
    for (let attempt = 0; attempt < 7; attempt++) {
      await new Promise(resolve => setTimeout(resolve, 1000 + attempt * 400));
      const result = await readCloud();
      if (!result.ok) throw new Error(result.error || 'Sync failed');
      recipes = result.recipes || [];
      if (verify()) {
        notice('');
        return true;
      }
    }
    throw new Error('Change not confirmed. Refresh before trying again.');
  } catch (error) {
    notice('Save not confirmed: ' + error.message);
    return false;
  } finally {
    busy = false;
    $('saveBtn').disabled = false;
  }
}

function show(view) {
  for (const id of ['homeView', 'detailView', 'editorView']) $(id).hidden = id !== view;
  $('addBtn').hidden = view === 'editorView';
  $('recipeMenu').hidden = true;
  window.scrollTo(0, 0);
}

function photoNode(url, className) {
  const wrap = document.createElement('div');
  wrap.className = className;
  if (url) {
    const img = document.createElement('img');
    img.src = url;
    img.alt = '';
    wrap.append(img);
  } else {
    wrap.textContent = '✿';
  }
  return wrap;
}

function renderHome() {
  const query = $('searchInput').value.trim().toLowerCase();
  const chapters = $('chapters');
  chapters.replaceChildren();
  const filtered = recipes.filter(recipe => {
    const ingredients = (recipe.sections || []).flatMap(section => section.ingredients || []);
    return [recipe.title, recipe.category, recipe.tags, ...ingredients]
      .join(' ').toLowerCase().includes(query);
  });
  $('recipeCount').textContent = filtered.length + ' recipes';
  for (const category of CATEGORIES) {
    const group = filtered.filter(recipe => recipe.category === category);
    if (!group.length) continue;
    const chapter = document.createElement('section');
    chapter.className = 'chapter';
    const title = document.createElement('h2');
    title.textContent = category;
    const grid = document.createElement('div');
    grid.className = 'recipe-grid';
    for (const recipe of group) {
      const card = document.createElement('button');
      card.type = 'button';
      card.className = 'recipe-card';
      card.append(photoNode(recipe.photoUrl, 'card-photo'));
      const name = document.createElement('span');
      name.className = 'card-title';
      name.textContent = recipe.title;
      card.append(name);
      card.onclick = () => openRecipe(recipe.id);
      grid.append(card);
    }
    chapter.append(title, grid);
    chapters.append(chapter);
  }
}

function openRecipe(id) {
  currentId = id;
  renderDetail();
  show('detailView');
}

function renderDetail() {
  const recipe = recipes.find(item => item.id === currentId);
  if (!recipe) { currentId = null; show('homeView'); return; }
  const hero = $('detailHero');
  hero.querySelector('img, .hero-placeholder')?.remove();
  hero.prepend(photoNode(recipe.photoUrl, 'hero-placeholder'));
  $('detailTitle').textContent = recipe.title;
  $('detailCategory').textContent = recipe.category;
  $('methodSection').hidden = !recipe.method;
  $('methodText').textContent = recipe.method || '';
  const list = $('ingredientList');
  list.replaceChildren();
  let total = 0;
  let checked = 0;
  (recipe.sections || []).forEach((section, sectionIndex) => {
    const block = document.createElement('section');
    block.className = 'ingredient-section';
    const heading = document.createElement('h3');
    heading.textContent = section.title || 'Main';
    block.append(heading);
    (section.ingredients || []).forEach((ingredient, ingredientIndex) => {
      const key = sectionIndex + ':' + ingredientIndex;
      const done = !!(recipe.checked || {})[key];
      total++;
      if (done) checked++;
      const label = document.createElement('label');
      label.className = 'ingredient-row' + (done ? ' checked' : '');
      const checkbox = document.createElement('input');
      checkbox.type = 'checkbox';
      checkbox.checked = done;
      const text = document.createElement('span');
      text.textContent = ingredient;
      checkbox.onchange = async () => {
        const updated = { ...(recipe.checked || {}), [key]: checkbox.checked };
        recipe.checked = updated;
        renderDetail();
        const success = await writeAndVerify(
          { action: 'check', id: recipe.id, checked: updated },
          () => JSON.stringify((recipes.find(r => r.id === recipe.id) || {}).checked || {}) === JSON.stringify(updated)
        );
        if (!success) await refresh();
        else renderDetail();
      };
      label.append(checkbox, text);
      block.append(label);
    });
    list.append(block);
  });
  $('ingredientProgress').textContent = checked + ' / ' + total;
}

function addSection(section = { title: '', ingredients: [] }, main = false) {
  const card = document.createElement('div');
  card.className = 'section-editor';
  const header = document.createElement('div');
  header.className = 'section-editor-header';
  const heading = document.createElement('strong');
  heading.textContent = main ? 'Main' : 'Extra section';
  header.append(heading);
  if (!main) {
    const remove = document.createElement('button');
    remove.type = 'button';
    remove.textContent = 'Remove';
    remove.onclick = () => card.remove();
    header.append(remove);
  }
  card.append(header);
  if (!main) {
    const titleLabel = document.createElement('label');
    titleLabel.textContent = 'Section title';
    const title = document.createElement('input');
    title.className = 'section-title';
    title.placeholder = 'e.g. Spice mix';
    title.required = true;
    title.value = section.title || '';
    titleLabel.append(title);
    card.append(titleLabel);
  }
  const ingredientLabel = document.createElement('label');
  ingredientLabel.textContent = 'Ingredients — one per line';
  const textarea = document.createElement('textarea');
  textarea.className = 'section-ingredients';
  textarea.rows = 5;
  textarea.placeholder = '2 onions\n1 tsp paprika';
  textarea.required = true;
  textarea.value = (section.ingredients || []).join('\n');
  ingredientLabel.append(textarea);
  card.append(ingredientLabel);
  $('sectionEditors').append(card);
}

function openEditor(id = null) {
  editingId = id;
  const recipe = recipes.find(item => item.id === id);
  $('editorTitle').textContent = recipe ? 'Edit recipe' : 'New recipe';
  $('recipeForm').reset();
  $('titleInput').value = recipe?.title || '';
  $('categoryInput').value = recipe?.category || 'Mains';
  $('methodInput').value = recipe?.method || '';
  $('tagsInput').value = recipe?.tags || '';
  selectedPhoto = '';
  $('photoPreview').hidden = !recipe?.photoUrl;
  $('photoPrompt').hidden = !!recipe?.photoUrl;
  if (recipe?.photoUrl) $('photoPreview').src = recipe.photoUrl;
  $('sectionEditors').replaceChildren();
  const sections = recipe?.sections?.length ? recipe.sections : [{ title: 'Main', ingredients: [] }];
  sections.forEach((section, index) => addSection(section, index === 0));
  show('editorView');
}

function imageAsJpeg(file) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      const scale = Math.min(1, 1100 / Math.max(img.width, img.height));
      const canvas = document.createElement('canvas');
      canvas.width = Math.round(img.width * scale);
      canvas.height = Math.round(img.height * scale);
      canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
      URL.revokeObjectURL(url);
      resolve(canvas.toDataURL('image/jpeg', 0.72));
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Cannot open photo')); };
    img.src = url;
  });
}

$('photoInput').onchange = async event => {
  const file = event.target.files[0];
  if (!file) return;
  try {
    selectedPhoto = await imageAsJpeg(file);
    $('photoPreview').src = selectedPhoto;
    $('photoPreview').hidden = false;
    $('photoPrompt').hidden = true;
  } catch (error) { notice(error.message); }
};

$('recipeForm').onsubmit = async event => {
  event.preventDefault();
  if (!configured()) { notice('Configure the cloud connection first.'); return; }
  const sections = [...$('sectionEditors').children].map((card, index) => ({
    title: index === 0 ? 'Main' : card.querySelector('.section-title').value.trim(),
    ingredients: card.querySelector('.section-ingredients').value.split('\n').map(s => s.trim()).filter(Boolean)
  }));
  if (sections.some(section => !section.title || !section.ingredients.length)) {
    notice('Each section needs a title and at least one ingredient.');
    return;
  }
  const existing = recipes.find(recipe => recipe.id === editingId);
  const id = editingId || (crypto.randomUUID ? crypto.randomUUID() : String(Date.now()));
  const recipe = {
    id,
    title: $('titleInput').value.trim(),
    category: $('categoryInput').value,
    method: $('methodInput').value.trim(),
    tags: $('tagsInput').value.trim(),
    sections,
    checked: existing?.checked || {},
    photoUrl: existing?.photoUrl || ''
  };
  const version = Date.now().toString();
  const success = await writeAndVerify(
    { action: 'save', recipe, photoData: selectedPhoto, version },
    () => (recipes.find(r => r.id === id) || {}).version === version
  );
  if (success) { renderHome(); openRecipe(id); }
};

$('uncheckBtn').onclick = async () => {
  const recipe = recipes.find(r => r.id === currentId);
  if (!recipe) return;
  recipe.checked = {};
  renderDetail();
  const success = await writeAndVerify(
    { action: 'check', id: recipe.id, checked: {} },
    () => Object.keys((recipes.find(r => r.id === recipe.id) || {}).checked || {}).length === 0
  );
  if (!success) await refresh();
  else renderDetail();
};

$('deleteBtn').onclick = async () => {
  if (!confirm('Delete this recipe?')) return;
  const id = currentId;
  const success = await writeAndVerify({ action: 'delete', id }, () => !recipes.some(r => r.id === id));
  if (success) { currentId = null; renderHome(); show('homeView'); }
};

$('backupBtn').onclick = () => {
  const blob = new Blob([JSON.stringify(recipes, null, 2)], { type: 'application/json' });
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = 'house-menu-backup.json';
  link.click();
  setTimeout(() => URL.revokeObjectURL(link.href), 1000);
};
$('refreshBtn').onclick = () => refresh();
$('searchInput').oninput = renderHome;
$('homeBtn').onclick = () => { currentId = null; renderHome(); show('homeView'); };
$('backBtn').onclick = () => { currentId = null; renderHome(); show('homeView'); };
$('addBtn').onclick = () => openEditor();
$('cancelBtn').onclick = () => currentId ? openRecipe(currentId) : show('homeView');
$('addSectionBtn').onclick = () => addSection();
$('menuBtn').onclick = () => { $('recipeMenu').hidden = !$('recipeMenu').hidden; };
$('editBtn').onclick = () => openEditor(currentId);

refresh();
// Sync when returning to the tab, without disturbing the editor.
document.addEventListener('visibilitychange', () => {
  if (!document.hidden && $('editorView').hidden && !busy) refresh(true);
});
