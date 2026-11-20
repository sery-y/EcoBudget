// app.js
/* EcoBudget — fonctionnalités personnelles. Données stockées côté serveur, un fichier JSON par compte (API /api/state). */
(() => {
  'use strict';

  const $ = (id) => document.getElementById(id);
  const STORAGE_KEY = 'ecobudget-personal-v2';
  const DEFAULT_CATEGORIES = [
    ['Alimentation', 'shopping-basket'], ['Transport', 'bus'], ['Logement', 'house'], ['Santé', 'heart-pulse'],
    ['Loisirs', 'clapperboard'], ['Etudes', 'graduation-cap'], ['Sport', 'dumbbell'], ['Voiture', 'car'],
    ['Reparations', 'wrench'], ['Enfants', 'baby'], ['Achats', 'shopping-bag'], ['Beaute', 'sparkles'],
    ['Vetements', 'shirt'], ['Voyages', 'plane'], ['Electronique', 'laptop'], ['Animaux', 'paw-print'],
    ['Cadeaux', 'gift'], ['Dons', 'hand-heart'], ['Telephone', 'smartphone'], ['Autres', 'circle-ellipsis']
  ].map(([nomCategorie, icone], i) => ({ idCategorie: i + 1, nomCategorie, icone }));
  const DEFAULT_SOURCES = [
    ['Salaire', 'briefcase-business'], ['Bourse', 'graduation-cap'], ['Cadeau', 'gift'],
    ['Temps partiel', 'clock'], ['Autres', 'circle-ellipsis']
  ].map(([nomSource, icone], i) => ({ idSource: i + 1, nomSource, icone }));
  const ICON_COLORS = ['#27c99a', '#e8b943', '#6ea9ff', '#b88bf5', '#e99565', '#fa7480', '#60bdc8', '#9dbb71', '#dd8cb6', '#8fc8a7'];
  const CHART_COLORS = ['#f59a80', '#b88bf5', '#f6c453', '#27c99a', '#68a9ff', '#df8ab7', '#7ebeb3', '#d69b66', '#9eae70', '#9b9b9b'];
  const now = new Date();
  const thisMonth = localMonth(now);
  let toastTimer = null;
  let state = emptyState();
  let stateLoaded = false; // tant que les données du serveur ne sont pas chargées, aucune sauvegarde n'est autorisée
  let currentPage = 'home';
  let pendingConfirmation = null;
  let currentTheme = 'dark';

  function localMonth(date) {
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
  }
  function localDate(date = new Date()) {
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
  }
  function emptyState() {
    return {
      profileName: 'Alif Reza',
      theme: 'dark',
      transactions: [],
      monthlyBudgets: {},
      monthlyCategoryLimits: {},
      budgetModes: {},
      goals: [],
      readAlerts: [],
      categories: DEFAULT_CATEGORIES.map(c => ({ ...c })),
      sources: DEFAULT_SOURCES.map(s => ({ ...s }))
    };
  }
  // Nettoie / complète un objet d'état (données serveur ou anciennes données localStorage)
  function normalizeState(parsed) {
    if (!parsed || typeof parsed !== 'object') return emptyState();
    const monthlyCategoryLimits = parsed.monthlyCategoryLimits && typeof parsed.monthlyCategoryLimits === 'object'
      ? parsed.monthlyCategoryLimits
      : {};
    return {
      ...emptyState(),
      ...parsed,
      theme: parsed.theme === 'light' ? 'light' : 'dark',
      transactions: Array.isArray(parsed.transactions) ? parsed.transactions : [],
      monthlyBudgets: parsed.monthlyBudgets && typeof parsed.monthlyBudgets === 'object' ? parsed.monthlyBudgets : {},
      monthlyCategoryLimits,
      budgetModes: parsed.budgetModes && typeof parsed.budgetModes === 'object' ? parsed.budgetModes : {},
      categories: Array.isArray(parsed.categories) && parsed.categories.length ? parsed.categories : DEFAULT_CATEGORIES.map(c => ({ ...c })),
      sources: Array.isArray(parsed.sources) && parsed.sources.length ? parsed.sources : DEFAULT_SOURCES.map(s => ({ ...s })),
      goals: Array.isArray(parsed.goals) ? parsed.goals.map(goal => ({
        ...goal,
        category: goal.category || '',
        description: goal.description || '',
        history: Array.isArray(goal.history) ? goal.history : []
      })) : []
    };
  }

  // Première utilisation avec le serveur : récupère les anciennes données du navigateur (si elles existent)
  function legacyLocalState() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return null;
      const legacy = normalizeState(JSON.parse(raw));
      legacy.theme = localStorage.getItem('ecobudget-theme') === 'light' ? 'light' : legacy.theme;
      return legacy;
    } catch (error) {
      console.warn('Anciennes données locales illisibles :', error);
      return null;
    }
  }

  function goToLogin() { location.replace('/login.html'); }

  // Utilisateur connecté (null + redirection vers la page de connexion si la session est absente ou expirée)
  async function fetchCurrentUser() {
    const response = await fetch('/api/auth/me', { cache: 'no-store' });
    if (response.status === 401) { goToLogin(); return null; }
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return (await response.json()).user;
  }

  async function loadStateFromServer() {
    const response = await fetch('/api/state', { cache: 'no-store' });
    if (response.status === 401) { goToLogin(); return null; }
    if (response.status === 204) {
      const legacy = legacyLocalState();
      return { state: legacy || emptyState(), isNew: true, fromLegacy: Boolean(legacy) };
    }
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return { state: normalizeState(await response.json()), isNew: false, fromLegacy: false };
  }

  // Sauvegarde vers data/data.json : les enregistrements sont envoyés l'un après l'autre,
  // et si plusieurs changements arrivent pendant un envoi, seul le dernier état est renvoyé.
  let saving = false;
  let dirty = false;
  async function flushState() {
    if (saving) return;
    saving = true;
    try {
      while (dirty) {
        dirty = false;
        const response = await fetch('/api/state', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(state)
        });
        if (response.status === 401) {
          dirty = false;
          showError('Votre session a expiré. Vous allez être redirigé vers la connexion.', 'Session expirée');
          setTimeout(goToLogin, 2000);
          return;
        }
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
      }
    } catch (error) {
      console.error(error);
      dirty = false;
      showError('Enregistrement impossible sur le serveur. Vérifiez qu’il est toujours démarré.');
    } finally {
      saving = false;
    }
  }
  function saveState() {
    if (!stateLoaded) {
      showError('Les données n’ont pas pu être chargées depuis le serveur : enregistrement désactivé pour protéger votre fichier.');
      return false;
    }
    dirty = true;
    flushState();
    return true;
  }
  // Dernière chance à la fermeture de l'onglet
  window.addEventListener('pagehide', () => {
    if (stateLoaded && (dirty || saving)) {
      navigator.sendBeacon('/api/state', new Blob([JSON.stringify(state)], { type: 'application/json' }));
    }
  });
  function money(value) {
    return new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 0 }).format(Number(value) || 0) + ' DA';
  }
  function amountNumber(value) { return Number.isFinite(Number(value)) ? Number(value) : 0; }
  function formatDate(value) {
    if (!value) return 'Date non définie';
    const [y, m, d] = value.split('-').map(Number);
    return new Date(y, m - 1, d).toLocaleDateString('fr-FR', { day: '2-digit', month: 'short', year: 'numeric' });
  }
  function monthLabel(value) {
    if (!value) return '';
    const [y, m] = value.split('-').map(Number);
    return new Date(y, m - 1, 1).toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' });
  }
  function escapeHtml(value = '') {
    return String(value).replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
  }
  function selectedMonth() { return $('monthFilter').value || thisMonth; }
  function transactionsFor(month = selectedMonth()) { return state.transactions.filter(t => t.date && t.date.slice(0, 7) === month); }
  function sumTransactions(list, type) { return list.filter(t => t.type === type).reduce((total, t) => total + amountNumber(t.amount), 0); }
  function incomeFor(month = selectedMonth()) { return sumTransactions(transactionsFor(month), 'Revenu'); }
  function expensesFor(month = selectedMonth()) { return sumTransactions(transactionsFor(month), 'Dépense'); }

  function cumulativeIncome() { return sumTransactions(state.transactions, 'Revenu'); }
  function cumulativeExpenses() { return sumTransactions(state.transactions, 'Dépense'); }
  function cumulativeBalance() { return cumulativeIncome() - cumulativeExpenses(); }

  function budgetFor(month = selectedMonth()) {
    return amountNumber(state.monthlyBudgets[month]);
  }
  function categoryLimitsFor(month = selectedMonth()) {
    const map = state.monthlyCategoryLimits?.[month];
    return map && typeof map === 'object' ? map : {};
  }
  function totalCategoryLimitsFor(month = selectedMonth()) {
    return Object.values(categoryLimitsFor(month)).reduce((sum, val) => sum + Math.max(0, amountNumber(val)), 0);
  }
  // Modes de budget : 'none' (aucun) · 'global' (mensuel seul) · 'category' (par catégorie seul)
  // · 'mixed' (mensuel + répartition par catégorie à l'intérieur).
  // Le mode choisi est mémorisé par mois (state.budgetModes) ; sans choix mémorisé, il est déduit des montants.
  const BUDGET_MODES = ['none', 'global', 'category', 'mixed'];
  function activeBudgetType(month = selectedMonth()) {
    const stored = state.budgetModes?.[month];
    if (BUDGET_MODES.includes(stored)) return stored;
    if (budgetFor(month) > 0 && totalCategoryLimitsFor(month) > 0) return 'mixed';
    if (budgetFor(month) > 0) return 'global';
    if (totalCategoryLimitsFor(month) > 0) return 'category';
    return 'none';
  }
  function setBudgetMode(month, mode) {
    if (!state.budgetModes) state.budgetModes = {};
    if (mode === 'none') delete state.budgetModes[month];
    else state.budgetModes[month] = mode;
  }
  // Mode mixte : combien reste-t-il à répartir entre catégories ? (on peut ignorer la limite d'une catégorie en cours de modification)
  function remainingToAllocate(month = selectedMonth(), excludeCategory = '') {
    const limits = categoryLimitsFor(month);
    const others = totalCategoryLimitsFor(month) - (excludeCategory ? Math.max(0, amountNumber(limits[excludeCategory])) : 0);
    return budgetFor(month) - others;
  }
  // Ce qui sert de « budget prévu » et ce qui est dépensé contre lui, selon le mode.
  function budgetSummary(month = selectedMonth()) {
    const mode = activeBudgetType(month);
    const monthly = budgetFor(month);
    const limits = categoryLimitsFor(month);
    const catTotal = totalCategoryLimitsFor(month);
    const spentInLimits = Object.keys(limits).reduce((sum, cat) => amountNumber(limits[cat]) > 0 ? sum + categoryExpenses(cat, month) : sum, 0);
    if ((mode === 'global' || mode === 'mixed') && monthly > 0) return { mode, monthly, catTotal, planned: monthly, spent: expensesFor(month) };
    if (mode === 'category' || mode === 'mixed') return { mode, monthly, catTotal, planned: catTotal, spent: spentInLimits };
    return { mode, monthly, catTotal, planned: 0, spent: expensesFor(month) };
  }
  function categoryExpenses(category, month = selectedMonth()) {
    return transactionsFor(month).filter(t => t.type === 'Dépense' && t.category === category).reduce((total, t) => total + amountNumber(t.amount), 0);
  }
  function totalSavedGoals() {
    return state.goals.reduce((total, goal) => total + amountNumber(goal.saved), 0);
  }

  // Montant encore réservé par le budget du mois (non dépensé). `custom` permet de simuler un autre budget.
  function reservedBudgetRemaining(month = selectedMonth(), custom = {}) {
    const mode = custom.mode ?? activeBudgetType(month);
    const monthly = custom.monthly !== undefined ? amountNumber(custom.monthly) : budgetFor(month);
    const limits = custom.limits !== undefined ? custom.limits : categoryLimitsFor(month);
    if ((mode === 'global' || mode === 'mixed') && monthly > 0) {
      return Math.max(0, monthly - expensesFor(month)); // l'enveloppe mensuelle couvre tout, catégories incluses
    }
    if (mode === 'category' || mode === 'mixed') {
      return Object.entries(limits).reduce((sum, [cat, lim]) => {
        const limitVal = amountNumber(lim);
        return limitVal <= 0 ? sum : sum + Math.max(0, limitVal - categoryExpenses(cat, month));
      }, 0);
    }
    return 0;
  }

  // Argent réellement libre : solde cumulé - total épargné - budget restant du MOIS EN COURS.
  // Valeur unique, identique partout (accueil, budget, alertes, épargne) quel que soit le mois affiché.
  function unallocatedFunds(month = thisMonth) {
    const base = cumulativeBalance() - totalSavedGoals();
    if (activeBudgetType(month) === 'none') return base;
    return base - reservedBudgetRemaining(month);
  }

  // Calcule sans compter une transaction (utile en modification : évite de la compter deux fois).
  function withoutTransaction(id, fn) {
    if (!id) return fn();
    const saved = state.transactions;
    state.transactions = saved.filter(t => t.id !== id);
    try { return fn(); } finally { state.transactions = saved; }
  }

  function evaluateExpenseCoverage({ id = '', category, amount, date }) {
    const month = date.slice(0, 7);
    const otherExpenses = state.transactions.filter(
      t => t.id !== id && t.type === 'Dépense' && t.date?.slice(0, 7) === month
    );
    const otherMonthlyExpenses = otherExpenses.reduce((sum, t) => sum + amountNumber(t.amount), 0);
    const projectedMonthly = otherMonthlyExpenses + amount;

    const otherCategoryExpenses = otherExpenses
      .filter(t => t.category === category)
      .reduce((sum, t) => sum + amountNumber(t.amount), 0);
    const projectedCategory = otherCategoryExpenses + amount;

    const mode = activeBudgetType(month);
    const categoryLimit = amountNumber(categoryLimitsFor(month)[category]);
    const monthlyLimit = budgetFor(month);
    const availableUnallocated = withoutTransaction(id, () => unallocatedFunds());

    // Mode mixte : l'enveloppe mensuelle ET (si elle existe) la limite de la catégorie doivent être respectées.
    if (mode === 'mixed' && monthlyLimit > 0) {
      const remainingMonthly = monthlyLimit - otherMonthlyExpenses;
      if (amount > remainingMonthly) {
        return {
          sufficient: false,
          title: 'Budget mensuel dépassé',
          message: `Budget mensuel insuffisant : manque ${money(projectedMonthly - monthlyLimit)} (budget : ${money(monthlyLimit)}, après dépense : ${money(projectedMonthly)}).`
        };
      }
      if (categoryLimit > 0) {
        const remainingCategory = categoryLimit - otherCategoryExpenses;
        const sufficient = amount <= remainingCategory;
        return {
          sufficient,
          title: 'Budget catégorie dépassé',
          message: sufficient
            ? `Budget « ${category} » OK (${money(remainingCategory - amount)} restants, ${money(remainingMonthly - amount)} sur le mois).`
            : `Budget « ${category} » insuffisant : manque ${money(projectedCategory - categoryLimit)} (budget : ${money(categoryLimit)}, après dépense : ${money(projectedCategory)}).`
        };
      }
      // Catégorie sans limite : elle puise dans la part non répartie du budget mensuel.
      const limits = categoryLimitsFor(month);
      const freePool = monthlyLimit - totalCategoryLimitsFor(month);
      const spentOutsideLimits = otherExpenses
        .filter(t => !(amountNumber(limits[t.category]) > 0))
        .reduce((sum, t) => sum + amountNumber(t.amount), 0);
      const remainingFree = freePool - spentOutsideLimits;
      const sufficient = amount <= remainingFree;
      return {
        sufficient,
        title: 'Part non répartie insuffisante',
        message: sufficient
          ? `Budget mensuel OK : « ${category} » n’a pas de limite, il reste ${money(remainingFree - amount)} de budget non réparti.`
          : `« ${category} » n’a pas de limite et le budget non réparti est insuffisant : manque ${money(amount - Math.max(0, remainingFree))} (non réparti : ${money(Math.max(0, remainingFree))}). Réservez la somme dans une limite ou augmentez le budget.`
      };
    }

    if (categoryLimit > 0 && (mode === 'category' || mode === 'mixed')) {
      const remainingCategory = categoryLimit - otherCategoryExpenses;
      const sufficient = amount <= remainingCategory;
      return {
        sufficient,
        title: 'Budget catégorie dépassé',
        message: sufficient
          ? `Budget « ${category} » OK (${money(remainingCategory - amount)} restants).`
          : `Budget « ${category} » insuffisant : manque ${money(projectedCategory - categoryLimit)} (budget : ${money(categoryLimit)}, après dépense : ${money(projectedCategory)}).`
      };
    }

    if (mode === 'global' && monthlyLimit > 0) {
      const remainingMonthly = monthlyLimit - otherMonthlyExpenses;
      const sufficient = amount <= remainingMonthly;
      return {
        sufficient,
        title: 'Budget mensuel dépassé',
        message: sufficient
          ? `Budget mensuel OK (${money(remainingMonthly - amount)} restants).`
          : `Budget mensuel insuffisant : manque ${money(projectedMonthly - monthlyLimit)} (budget : ${money(monthlyLimit)}, après dépense : ${money(projectedMonthly)}).`
      };
    }

    const sufficient = amount <= availableUnallocated;
    return {
      sufficient,
      title: 'Argent non affecté insuffisant',
      message: sufficient
        ? `Aucun budget défini : argent non affecté OK (${money(availableUnallocated - amount)} restants).`
        : `Aucun budget défini : argent non affecté insuffisant, manque ${money(amount - availableUnallocated)} (disponible : ${money(availableUnallocated)}).`
    };
  }

  function entriesFor(type) {
    return type === 'Revenu'
      ? state.sources.map(s => ({ id: s.idSource, name: s.nomSource, icon: s.icone, custom: Boolean(s.custom) }))
      : state.categories.map(c => ({ id: c.idCategorie, name: c.nomCategorie, icon: c.icone, custom: Boolean(c.custom) }));
  }
  function findEntry(name, type = 'Dépense') {
    const list = entriesFor(type);
    const index = list.findIndex(e => e.name === name);
    if (index >= 0) return { ...list[index], color: ICON_COLORS[index % ICON_COLORS.length] };
    return { id: 0, name, icon: 'circle-ellipsis', custom: false, color: '#999999' };
  }
  function iconMarkup(iconValue) {
    if (typeof iconValue === 'string' && iconValue.startsWith('data:image')) return `<img src="${escapeHtml(iconValue)}" alt="" class="custom-icon-img">`;
    return `<i data-lucide="${escapeHtml(iconValue || 'circle-ellipsis')}"></i>`;
  }
  function categoryIcon(category, type = 'Dépense') {
    const entry = findEntry(category, type);
    return `<span class="category-icon" style="--c:${entry.color}" aria-hidden="true">${iconMarkup(entry.icon)}</span>`;
  }
  function showError(message, title = 'Vérification nécessaire') {
    $('messageDialog').dataset.messageType = 'error';
    $('messageTitle').textContent = title;
    $('messageText').textContent = message;
    $('messageDialog').showModal();
    $('messageDialog').querySelector('.dialog-symbol').innerHTML = icon('alert-circle');
    $('messageDialog').querySelector('.dialog-symbol').className = 'dialog-symbol error-symbol';
    refreshIcons();
  }
  function icon(name, extraClass = '') { return `<i data-lucide="${escapeHtml(name)}"${extraClass ? ` class="${extraClass}"` : ''} aria-hidden="true"></i>`; }
  function refreshIcons() {
    if (window.lucide && typeof window.lucide.createIcons === 'function') {
      window.lucide.createIcons({ attrs: { 'stroke-width': 1.8 } });
    }
  }
  function toast(message) {
    const element = $('toast');
    element.textContent = message;
    element.classList.add('show');
    window.clearTimeout(toastTimer);
    toastTimer = window.setTimeout(() => element.classList.remove('show'), 4200);
  }
  function askConfirmation(title, message, confirmLabel = 'Confirmer', danger = true) {
    return new Promise(resolve => {
      if (pendingConfirmation) pendingConfirmation(false);
      pendingConfirmation = resolve;
      $('confirmTitle').textContent = title;
      $('confirmMessage').textContent = message;
      $('confirmAccept').textContent = confirmLabel;
      $('confirmAccept').classList.toggle('danger-button', danger);
      $('confirmAccept').classList.toggle('primary-button', !danger);
      if (!$('confirmDialog').open) $('confirmDialog').showModal();
      refreshIcons();
    });
  }
  function finishConfirmation(value) {
    if (!pendingConfirmation) return;
    const resolve = pendingConfirmation;
    pendingConfirmation = null;
    if ($('confirmDialog').open) $('confirmDialog').close();
    resolve(value);
  }

  function applyTheme(theme, persist = false) {
    currentTheme = theme === 'light' ? 'light' : 'dark';
    document.documentElement.dataset.theme = currentTheme;
    document.body.dataset.theme = currentTheme;
    state.theme = currentTheme;
    if (persist) saveState();
    const light = currentTheme === 'light';
    $('themeToggle').innerHTML = icon(light ? 'moon' : 'sun');
    $('themeToggle').setAttribute('aria-label', light ? 'Activer le mode sombre' : 'Activer le mode clair');
    $('themeToggle').title = light ? 'Passer au mode sombre' : 'Passer au mode clair';
    $('themeColorMeta').content = light ? '#f5f6f8' : '#121212';
    refreshIcons();
  }

  function navigate(page) {
    const valid = ['home', 'expenses', 'savings', 'budget', 'stats', 'settings'];
    if (!valid.includes(page)) return;
    currentPage = page;
    $('periodControl').hidden = !['home', 'budget', 'stats'].includes(page);
    document.querySelectorAll('.page').forEach(section => section.classList.toggle('active', section.id === `page-${page}`));
    document.querySelectorAll('.nav-link[data-page]').forEach(button => {
      const active = button.dataset.page === page;
      button.classList.toggle('active', active);
      if (active) button.setAttribute('aria-current', 'page'); else button.removeAttribute('aria-current');
    });
    $('recentSidebar').classList.toggle('hidden-on-mobile', page !== 'home');
    if (page === 'budget') {
      renderBudget();
    }
    if (page === 'savings') renderSavings();
    if (page === 'stats') renderStats();
    if (page === 'expenses') renderTransactions();
    if (page === 'settings') renderSettings();
    refreshIcons();
    if (window.innerWidth < 650) $('sidebar').classList.remove('open');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  // ---------- Tableau de bord ----------
  function renderHome() {
    const month = selectedMonth();
    const income = incomeFor(month);
    const expenses = expensesFor(month);
    const balance = cumulativeBalance();
    const summary = budgetSummary(month);
    const activeType = summary.mode;
    const monthlyBudget = summary.monthly;
    const catLimitsTotal = summary.catTotal;
    const effectiveBudget = summary.planned;
    const effectiveSpent = summary.spent;
    const monthlyDriven = (activeType === 'global' || activeType === 'mixed') && monthlyBudget > 0;

    const remaining = effectiveBudget ? effectiveBudget - effectiveSpent : null;
    const pct = effectiveBudget > 0 ? Math.min(100, effectiveSpent / effectiveBudget * 100) : 0;
    const activeGoals = state.goals.filter(goal => amountNumber(goal.saved) < amountNumber(goal.target));
    const activeSaved = activeGoals.reduce((total, goal) => total + amountNumber(goal.saved), 0);
    const activeTarget = activeGoals.reduce((total, goal) => total + amountNumber(goal.target), 0);
    const savingsPct = activeTarget > 0 ? Math.min(100, activeSaved / activeTarget * 100) : 0;
    const unallocated = unallocatedFunds();

    document.querySelectorAll('[data-period]').forEach(el => { el.textContent = monthLabel(month); });
    $('homeBalance').textContent = money(balance);
    $('homeBalance').style.color = balance < 0 ? '#8a1c10' : '#111';
    $('homeIncome').textContent = money(income);
    $('homeExpenses').textContent = money(expenses);

    $('homeBudgetAmount').textContent = monthlyDriven
      ? (activeType === 'mixed' ? `${money(monthlyBudget)} (mensuel)` : money(monthlyBudget))
      : (effectiveBudget > 0 ? `${money(catLimitsTotal)} (catégories)` : 'Aucun budget');

    $('homeGaugePercent').textContent = effectiveBudget ? `${Math.round(pct)} %` : '—';
    $('homeSpentPercent').textContent = effectiveBudget ? `${Math.round(pct)} %` : '—';
    $('homeRemainingPercent').textContent = effectiveBudget ? `${Math.max(0, 100 - Math.round(pct))} %` : '—';
    const circleLength = 330;
    $('homeGauge').style.strokeDasharray = `${circleLength * pct / 100} ${circleLength}`;
    $('homeGauge').style.stroke = pct >= 100 ? 'var(--danger)' : pct >= 80 ? 'var(--yellow)' : 'var(--coral)';

    $('homeBudgetHint').textContent = effectiveBudget
      ? `${money(remaining)} ${remaining < 0 ? 'de dépassement' : 'restants'}${activeType === 'mixed' && monthlyDriven ? ` · ${money(Math.max(0, remainingToAllocate(month)))} à répartir` : ''}`
      : 'Aucun budget : comparaison avec l’argent non affecté.';

    $('homeSavingsBar').style.width = `${savingsPct}%`;
    $('homeUnallocated').textContent = money(unallocated);
    $('homeUnallocated').classList.toggle('negative-value', unallocated < 0);
    $('homeUnallocatedDetail').textContent = 'Solde − épargne − budget restant (mois en cours)';

    $('homeSavingsProgress').textContent = activeTarget > 0 ? `${Math.round(savingsPct)} %` : '—';
    $('homeSavingsDetail').textContent = activeTarget > 0 ? `${money(activeSaved)} sur ${money(activeTarget)} · ${activeGoals.length} actif(s)` : 'Aucun objectif actif';

    const recent = [...transactionsFor(month)].sort((a, b) => b.date.localeCompare(a.date) || (b.createdAt || 0) - (a.createdAt || 0)).slice(0, 5);
    $('recentTransactions').innerHTML = recent.map(t => {
      const incomeType = t.type === 'Revenu';
      return `<article class="recent-item"><div class="recent-item-main"><div class="recent-left"><div class="recent-name">${escapeHtml(t.description || t.category)}</div><span class="recent-meta ${incomeType ? 'income' : ''}">${incomeType ? 'Revenu' : 'Dépense'} · ${categoryIcon(t.category, t.type)} ${escapeHtml(t.category)}</span></div><div class="recent-amount ${incomeType ? 'income' : ''}">${incomeType ? '+' : '−'}${money(t.amount)}</div></div><div class="recent-actions"><button type="button" class="table-action" data-edit-transaction="${escapeHtml(t.id)}">Modifier</button><button type="button" class="table-action delete" data-delete-transaction="${escapeHtml(t.id)}">Supprimer</button></div></article>`;
    }).join('');
    $('recentEmpty').hidden = recent.length > 0;
    renderHomeComparison(month, income, expenses);

    // Le tableau de bord n'affiche que les alertes non lues (les alertes lues restent dans les notifications)
    const alerts = unreadAlerts(month);
    $('recentAlert').innerHTML = alerts.length ? alerts.map((message) => `<article class="alert-item ${/dépass|insuffisant|inhabituelle|échéance/i.test(message) ? 'danger' : 'warning'}"><span class="alert-item-icon">${icon(/dépass|insuffisant|inhabituelle|échéance/i.test(message) ? 'alert-triangle' : 'alert-circle')}</span><span>${escapeHtml(message)}</span></article>`).join('') : '<p class="sidebar-empty">Aucune alerte.</p>';
    $('alertCount').textContent = String(alerts.length);
    const unread = unreadAlerts(month).length;
    $('notificationDot').hidden = unread === 0;
    $('notificationDot').textContent = unread > 9 ? '9+' : String(unread);

    refreshIcons();
  }
  function renderHomeComparison(month, income, expenses) {
    const max = Math.max(income, expenses, 1);
    $('homeIncomeExpense').innerHTML = [
      { label: 'Revenus', value: income, color: 'var(--green)' },
      { label: 'Dépenses', value: expenses, color: 'var(--coral)' }
    ].map(row => `<div class="comparison-row"><span>${row.label}</span><div class="comparison-track"><span style="width:${Math.max(row.value ? 2 : 0, row.value / max * 100)}%;background:${row.color}"></span></div><b>${money(row.value)}</b></div>`).join('');
  }

  // ---------- Transactions / Dépenses ----------
  let newCategoryIcon = '';
  let goalNewCategoryIcon = '';

  function setTransactionType(type) {
    $('transactionType').value = type;
    document.querySelectorAll('.type-option').forEach(btn => {
      const active = btn.dataset.type === type;
      btn.classList.toggle('active', active);
      btn.setAttribute('aria-pressed', String(active));
    });
    $('categoryPickerLabel').innerHTML = `${type === 'Revenu' ? 'Source du revenu' : 'Catégorie'} <span class="req" title="Obligatoire" aria-hidden="true">*</span>`;
    $('transactionAmount').placeholder = type === 'Revenu' ? 'Ex. 50000 (salaire du mois)' : 'Ex. 2500 (courses de la semaine)';
    $('transactionDescription').placeholder = type === 'Revenu' ? 'Ex. Salaire de novembre' : 'Ex. Courses au supermarché';
    $('newCategoryName').placeholder = type === 'Revenu' ? 'Ex. Freelance' : 'Ex. Abonnements';
  }
  function fillCategories() {
    const type = $('transactionType').value;
    const selected = $('transactionCategory').value;
    const list = entriesFor(type);
    const known = list.some(e => e.name === selected);
    if (!known) $('transactionCategory').value = '';
    const tiles = list.map((entry, index) => {
      const color = ICON_COLORS[index % ICON_COLORS.length];
      const active = entry.name === $('transactionCategory').value;
      return `<div class="cat-tile-wrap"><button type="button" class="cat-tile ${active ? 'selected' : ''}" role="radio" aria-checked="${active}" data-category="${escapeHtml(entry.name)}"><span class="category-icon" style="--c:${color}">${iconMarkup(entry.icon)}</span><span class="cat-name">${escapeHtml(entry.name)}</span></button>${entry.custom ? `<button type="button" class="cat-remove" data-remove-category="${escapeHtml(entry.name)}" aria-label="Supprimer ${escapeHtml(entry.name)}">×</button>` : ''}</div>`;
    });
    if (selected && !known && selected.trim()) {
      $('transactionCategory').value = selected;
      tiles.push(`<div class="cat-tile-wrap"><button type="button" class="cat-tile selected" role="radio" aria-checked="true" data-category="${escapeHtml(selected)}"><span class="category-icon" style="--c:#999">${iconMarkup('circle-ellipsis')}</span><span class="cat-name">${escapeHtml(selected)}</span></button></div>`);
    }
    tiles.push(`<div class="cat-tile-wrap"><button type="button" class="cat-tile add-tile" id="addCategoryTile"><span class="category-icon" style="--c:#999">${iconMarkup('plus')}</span><span class="cat-name">Nouvelle</span></button></div>`);
    $('categoryPicker').innerHTML = tiles.join('');
    refreshIcons();
  }
  function resetNewCategoryPanel() {
    newCategoryIcon = '';
    $('newCategoryName').value = '';
    $('newCategoryIconFile').value = '';
    $('newCategoryIconPreview').innerHTML = '<i data-lucide="image-plus"></i>';
    $('newCategoryPanel').hidden = true;
    refreshIcons();
  }
  function openNewCategoryPanel() {
    const type = $('transactionType').value;
    $('newCategoryTitle').textContent = type === 'Revenu' ? 'Nouvelle source de revenu' : 'Nouvelle catégorie';
    $('newCategoryName').placeholder = type === 'Revenu' ? 'Ex. Freelance' : 'Ex. Abonnements';
    $('newCategoryPanel').hidden = false;
    $('newCategoryPanel').scrollIntoView({ block: 'nearest' });
    $('newCategoryName').focus();
  }
  function importIconFile(file) {
    return new Promise((resolve, reject) => {
      if (!file || !file.type.startsWith('image/')) { reject(new Error('Choisissez un fichier image.')); return; }
      const reader = new FileReader();
      reader.onerror = () => reject(new Error('Lecture impossible.'));
      reader.onload = () => {
        const img = new Image();
        img.onerror = () => reject(new Error('Image invalide.'));
        img.onload = () => {
          const size = 96, canvas = document.createElement('canvas');
          canvas.width = canvas.height = size;
          const ctx = canvas.getContext('2d');
          const w = img.naturalWidth || size, h = img.naturalHeight || size, scale = Math.min(size / w, size / h);
          ctx.drawImage(img, (size - w * scale) / 2, (size - h * scale) / 2, w * scale, h * scale);
          resolve(canvas.toDataURL('image/png'));
        };
        img.src = reader.result;
      };
      reader.readAsDataURL(file);
    });
  }
  function saveNewCategory() {
    const type = $('transactionType').value;
    const name = $('newCategoryName').value.trim();
    if (!name) { showError('Nom requis.'); return; }
    if (!newCategoryIcon) { showError('Icône requise.'); return; }
    const list = entriesFor(type);
    if (list.some(e => e.name.toLowerCase() === name.toLowerCase())) { showError('Nom déjà utilisé.'); return; }
    if (type === 'Revenu') {
      const id = state.sources.reduce((m, s) => Math.max(m, s.idSource), 0) + 1;
      state.sources.push({ idSource: id, nomSource: name, icone: newCategoryIcon, custom: true });
    } else {
      const id = state.categories.reduce((m, c) => Math.max(m, c.idCategorie), 0) + 1;
      state.categories.push({ idCategorie: id, nomCategorie: name, icone: newCategoryIcon, custom: true });
    }
    if (!saveState()) return;
    $('transactionCategory').value = name;
    resetNewCategoryPanel();
    fillCategories();
    toast('Ajouté.');
  }
  async function removeCustomCategory(name) {
    const type = $('transactionType').value;
    const accepted = await askConfirmation('Supprimer cette catégorie ?', `Supprimer « ${name} » ?`);
    if (!accepted) return;
    if (type === 'Revenu') state.sources = state.sources.filter(s => !(s.custom && s.nomSource === name));
    else state.categories = state.categories.filter(c => !(c.custom && c.nomCategorie === name));
    if ($('transactionCategory').value === name) $('transactionCategory').value = '';
    saveState(); fillCategories();
  }
  function openTransactionDialog(transaction = null) {
    $('transactionForm').reset();
    $('transactionError').textContent = '';
    resetNewCategoryPanel();
    $('transactionId').value = transaction?.id || '';
    $('transactionDialogTitle').textContent = transaction ? 'Modifier la transaction' : 'Ajouter une transaction';
    setTransactionType(transaction?.type || 'Dépense');
    $('transactionCategory').value = transaction?.category || '';
    fillCategories();
    if (transaction) {
      $('transactionAmount').value = transaction.amount;
      $('transactionDate').value = transaction.date;
      $('transactionDescription').value = transaction.description || '';
    } else {
      $('transactionDate').value = localDate();
    }
    $('transactionDialog').showModal();
  }
  const MIN_EXPENSES_FOR_AVERAGE = 5; // nombre minimum de dépenses précédentes dans la catégorie
  function assessUnusual(transaction) {
    if (transaction.type !== 'Dépense') return '';
    const previous = state.transactions.filter(t => t.id !== transaction.id && t.type === 'Dépense' && t.category === transaction.category && t.date < transaction.date);
    if (previous.length >= MIN_EXPENSES_FOR_AVERAGE) { // assez d'historique dans la catégorie pour que la moyenne soit fiable
      const average = previous.reduce((total, t) => total + amountNumber(t.amount), 0) / previous.length;
      if (average > 0 && amountNumber(transaction.amount) >= average * 2) {
        return `Dépense inhabituelle : ${money(transaction.amount)} en ${transaction.category} (moyenne : ${money(average)}).`;
      }
    }
    const monthIncome = incomeFor(transaction.date.slice(0, 7));
    if (monthIncome > 0 && amountNumber(transaction.amount) >= monthIncome * 0.3) {
      return `Dépense importante : ${money(transaction.amount)} (≥ 30 % des revenus du mois).`;
    }
    return '';
  }

  async function saveTransaction(event) {
    event.preventDefault();
    const id = $('transactionId').value;
    const amount = Number($('transactionAmount').value);
    const date = $('transactionDate').value;
    const category = $('transactionCategory').value;
    const type = $('transactionType').value;
    if (!category) { showError('Choisissez une catégorie.'); return; }
    if (!Number.isFinite(amount) || amount <= 0) { showError('Montant invalide.'); return; }
    if (!date) { showError('Date requise.'); return; }
    if (date > localDate()) { showError('Date future interdite.'); return; }

    const existing = state.transactions.find(t => t.id === id);
    const transaction = {
      id: id || makeId(), type, category, amount, date,
      description: $('transactionDescription').value.trim(),
      createdAt: existing?.createdAt || Date.now()
    };

    let coverageStatus = '';
    if (type === 'Dépense') {
      const coverage = evaluateExpenseCoverage({ id, category, amount, date });
      coverageStatus = coverage.sufficient ? 'OK' : 'Insuffisant';

      if (!coverage.sufficient) {
        const accepted = await askConfirmation(
          coverage.title,
          `${coverage.message}\n\nEnregistrer quand même ?`,
          'Enregistrer',
          false
        );
        if (!accepted) return;
      }
    }

    const beforeUnread = unreadAlerts(selectedMonth()).length;
    // Une dépense déjà confirmée « normale » ne doit pas être re-signalée si montant et catégorie n'ont pas changé.
    const keepNormal = existing?.unusualConfirmedNormal && existing.category === transaction.category && amountNumber(existing.amount) === transaction.amount;
    if (keepNormal) transaction.unusualConfirmedNormal = true;
    const unusualMessage = keepNormal ? '' : assessUnusual(transaction);
    transaction.unusual = Boolean(unusualMessage);
    transaction.unusualReason = unusualMessage;
    if (existing) Object.assign(existing, transaction);
    else state.transactions.push(transaction);
    saveState();
    $('transactionDialog').close();
    renderAll();
    const newAlerts = unreadAlerts(selectedMonth()).length - beforeUnread;
    const baseMsg = existing ? 'Modifiée.' : 'Enregistrée.';
    const coverageNote = type === 'Dépense' ? ` (${coverageStatus})` : '';
    const alertNote = newAlerts > 0 ? ` · ${newAlerts} alerte${newAlerts > 1 ? 's' : ''}` : '';
    toast(`${baseMsg}${coverageNote}${alertNote}`);
  }

  function syncTransactionEntryFilter() {
    const typeFilter = $('expenseTypeFilter').value;
    const entrySelect = $('expenseEntryFilter');
    const previousValue = entrySelect.value;

    // Bloqué tant que l'utilisateur n'a pas choisi Dépense ou Revenu
    if (typeFilter !== 'Dépense' && typeFilter !== 'Revenu') {
      entrySelect.disabled = true;
      entrySelect.setAttribute('aria-label', 'Choisissez un type d’abord');
      entrySelect.innerHTML = `<option value="Tous">Choisissez un type d'abord</option>`;
      entrySelect.value = 'Tous';
      return;
    }

    entrySelect.disabled = false;
    const isIncome = typeFilter === 'Revenu';
    const defaultLabel = isIncome ? 'Toutes les sources' : 'Toutes les catégories';

    const names = new Set([
      ...entriesFor(typeFilter).map(e => e.name),
      ...state.transactions.filter(t => t.type === typeFilter).map(t => t.category)
    ]);
    const options = [...names].sort((a, b) => a.localeCompare(b, 'fr'));

    entrySelect.setAttribute(
      'aria-label',
      isIncome ? 'Filtrer par source de revenu' : 'Filtrer par catégorie de dépense'
    );

    entrySelect.innerHTML = [
      `<option value="Tous">${escapeHtml(defaultLabel)}</option>`,
      ...options.map(name => `<option value="${escapeHtml(name)}">${escapeHtml(name)}</option>`)
    ].join('');

    entrySelect.value = options.includes(previousValue) ? previousValue : 'Tous';
  }

  const TRANSACTIONS_PER_PAGE = 5;
  let transactionPage = 1, transactionFilterKey = '';
  function renderTransactions(globalQuery = '') {
    syncTransactionEntryFilter();
    const type = $('expenseTypeFilter').value;
    const entry = $('expenseEntryFilter').value;
    const dateFilter = $('expenseDateFilter').value;
    const query = String(globalQuery || '').trim().toLowerCase();

    const hasActiveFilter = type !== 'Tous' || entry !== 'Tous' || Boolean(dateFilter) || Boolean(query);
    $('clearExpenseFilters').hidden = !hasActiveFilter;

    const rows = [...state.transactions]
      .filter(t => {
        const matchesType = type === 'Tous' || t.type === type;
        const matchesEntry = entry === 'Tous' || t.category === entry;
        const matchesDate = !dateFilter || t.date === dateFilter;
        const matchesQuery = !query || `${t.category} ${t.description || ''} ${t.type} ${t.date}`.toLowerCase().includes(query);
        return matchesType && matchesEntry && matchesDate && matchesQuery;
      })
      .sort((a, b) => b.date.localeCompare(a.date) || (b.createdAt || 0) - (a.createdAt || 0));

    const inc = sumTransactions(rows, 'Revenu'), exp = sumTransactions(rows, 'Dépense');
    $('expenseKpis').innerHTML = `<div class="stats-kpis-item stats-kpi"><small>Solde cumulé</small><strong>${money(cumulativeBalance())}</strong></div><div class="stats-kpi"><small>Revenus</small><strong>${money(inc)}</strong></div><div class="stats-kpi"><small>Dépenses</small><strong>${money(exp)}</strong></div>`;
    // Pagination : 5 transactions par page ; retour à la page 1 quand un filtre change.
    const filterKey = [type, entry, dateFilter, query].join('|');
    if (filterKey !== transactionFilterKey) { transactionFilterKey = filterKey; transactionPage = 1; }
    const pageCount = Math.max(1, Math.ceil(rows.length / TRANSACTIONS_PER_PAGE));
    transactionPage = Math.min(Math.max(1, transactionPage), pageCount);
    const pageRows = rows.slice((transactionPage - 1) * TRANSACTIONS_PER_PAGE, transactionPage * TRANSACTIONS_PER_PAGE);
    $('transactionPager').hidden = rows.length <= TRANSACTIONS_PER_PAGE;
    $('pageInfo').textContent = `Page ${transactionPage} / ${pageCount}`;
    $('pagePrev').disabled = transactionPage <= 1;
    $('pageNext').disabled = transactionPage >= pageCount;
    $('transactionCount').textContent = `${rows.length} transaction${rows.length > 1 ? 's' : ''}`;
    $('transactionsTable').innerHTML = pageRows.map(t => `<tr><td>${formatDate(t.date)}</td><td><span class="type-pill ${t.type === 'Revenu' ? 'in' : 'out'}">${t.type}</span></td><td>${categoryIcon(t.category, t.type)} ${escapeHtml(t.category)}</td><td>${escapeHtml(t.description || '—')}</td><td class="${t.type === 'Revenu' ? 'income-text' : 'expense-text'}">${t.type === 'Revenu' ? '+' : '−'}${money(t.amount)}</td><td><button class="table-action" data-edit-transaction="${t.id}" aria-label="Modifier">Modifier</button><button class="table-action delete" data-delete-transaction="${t.id}" aria-label="Supprimer">Supprimer</button></td></tr>`).join('');
    $('transactionsEmpty').hidden = rows.length > 0;
    refreshIcons();
  }
  async function deleteTransaction(id) {
    const transaction = state.transactions.find(t => t.id === id);
    if (!transaction) return;
    const accepted = await askConfirmation('Supprimer la transaction ?', `${transaction.category} — ${money(transaction.amount)}`);
    if (!accepted) return;
    state.transactions = state.transactions.filter(t => t.id !== id);
    saveState(); renderAll(); toast('Supprimée.');
  }

  // ---------- Budget (4 modes : aucun / mensuel seul / catégories seules / mensuel + catégories) ----------
  function renderBudget() {
    const month = selectedMonth();
    const summary = budgetSummary(month);
    const viewMode = summary.mode;
    const monthlyBudget = summary.monthly;
    const catTotal = summary.catTotal;
    const actual = expensesFor(month);
    const unallocated = unallocatedFunds();
    const planned = summary.planned;
    const spentAgainstBudget = summary.spent;
    const remaining = planned - spentAgainstBudget;
    const pct = planned > 0 ? spentAgainstBudget / planned * 100 : 0;
    const showsMonthly = viewMode === 'global' || viewMode === 'mixed';
    const showsCategories = viewMode === 'category' || (viewMode === 'mixed' && monthlyBudget > 0);

    BUDGET_MODES.forEach(mode => {
      const btn = document.querySelector(`[data-budget-mode="${mode}"]`);
      if (!btn) return;
      btn.classList.toggle('active', viewMode === mode);
      btn.setAttribute('aria-checked', String(viewMode === mode));
    });

    $('noBudgetPanel').hidden = viewMode !== 'none';
    $('globalBudgetPanel').hidden = !showsMonthly;
    $('categoryBudgetPanel').hidden = !(viewMode === 'category' || viewMode === 'mixed');
    $('budgetComparisonPanel').hidden = !showsCategories;
    $('budgetKpis').hidden = viewMode === 'none' || planned <= 0;

    if (viewMode === 'none') {
      $('budgetModeGuide').innerHTML = `<span><strong>Aucun budget</strong> · Argent non affecté : <b>${money(unallocated)}</b></span>`;
      $('noBudgetSummary').innerHTML = `
        <div class="insight">
          <small>Argent non affecté disponible</small>
          <strong class="${unallocated < 0 ? 'negative-value' : ''}">${money(unallocated)}</strong>
          <span>Hors épargne, sans budget réservé</span>
        </div>
        <div class="insight">
          <small>Dépenses du mois</small>
          <strong>${money(actual)}</strong>
          <span>${monthLabel(month)}</span>
        </div>
        <div class="insight">
          <small>Solde cumulé</small>
          <strong>${money(cumulativeBalance())}</strong>
          <span>Revenus − dépenses</span>
        </div>
      `;
      refreshIcons();
      return;
    }

    // KPIs communs
    $('budgetPlannedKpi').textContent = money(planned);
    $('budgetActualKpi').textContent = money(spentAgainstBudget);
    $('budgetRemainingKpi').textContent = planned ? money(remaining) : '—';
    $('budgetRemainingLabel').textContent = planned && remaining < 0 ? 'Dépassement' : 'Montant restant';
    $('budgetRemainingKpi').style.color = planned && remaining < 0 ? 'var(--danger)' : 'var(--green)';

    if (showsMonthly) {
      $('globalBudgetTitle').textContent = viewMode === 'mixed' ? 'Budget mensuel (enveloppe)' : 'Budget mensuel global';
      $('monthlyBudgetInput').value = monthlyBudget || '';
      $('monthlyBudgetSubmit').textContent = monthlyBudget > 0 ? 'Modifier' : 'Enregistrer';
      $('clearMonthlyBudget').hidden = monthlyBudget <= 0;
      $('globalBudgetTracking').hidden = monthlyBudget <= 0;
      $('globalBudgetHint').textContent = viewMode === 'mixed'
        ? 'Champ obligatoire · vous répartissez ensuite cette enveloppe entre vos catégories. Ne peut pas être inférieur au total déjà réparti.'
        : 'Champ obligatoire · vérifié avec l’argent non affecté. Saisissez 0 pour supprimer le budget.';

      const fill = $('budgetProgressBar');
      fill.style.width = `${Math.min(100, pct)}%`;
      fill.className = pct >= 100 ? 'danger' : pct >= 80 ? 'warning' : '';
      $('budgetProgressLabel').textContent = planned ? `${Math.round(pct)} %` : '0 %';
      $('budgetStatusLabel').textContent = monthLabel(month);

      const alert = $('budgetAlert');
      if (!planned || monthlyBudget <= 0) {
        alert.hidden = true;
      } else if (spentAgainstBudget >= planned) {
        alert.hidden = false;
        alert.className = 'alert-box danger';
        alert.textContent = `Budget dépassé de ${money(spentAgainstBudget - planned)}.`;
      } else if (pct >= 80) {
        alert.hidden = false;
        alert.className = 'alert-box warning';
        alert.textContent = `${Math.round(pct)} % utilisé (${money(remaining)} restants).`;
      } else {
        alert.hidden = true;
      }
    }

    // Panneau des catégories (mode « catégories seules » ou « mensuel + catégories »)
    const allocated = $('allocationSummary');
    allocated.hidden = true;
    if (viewMode === 'category' || viewMode === 'mixed') {
      const canAdd = viewMode === 'category' || monthlyBudget > 0;
      $('addCategoryLimit').hidden = !canAdd;
      $('clearAllCategoryLimits').hidden = catTotal <= 0;
      $('categoryBudgetTitle').textContent = viewMode === 'mixed' ? 'Répartition par catégorie' : 'Budgets par catégorie';
      $('limitsEmpty').textContent = viewMode === 'mixed' && !canAdd
        ? 'Définissez d’abord le budget mensuel ci-dessus, puis répartissez-le entre vos catégories.'
        : 'Aucun budget par catégorie.';
      if (viewMode === 'mixed' && monthlyBudget > 0) {
        const left = remainingToAllocate(month);
        const share = monthlyBudget > 0 ? Math.min(100, catTotal / monthlyBudget * 100) : 0;
        allocated.hidden = false;
        $('allocMonthly').textContent = money(monthlyBudget);
        $('allocUsed').textContent = money(catTotal);
        $('allocRemaining').textContent = money(Math.max(0, left));
        $('allocRemainingNote').textContent = left > 0 ? 'Disponible pour de nouvelles catégories' : (left === 0 ? 'Tout le budget est réparti' : `Sur-réparti de ${money(-left)}`);
        $('allocRemainingBox').classList.toggle('bad', left < 0);
        $('allocBar').style.width = `${share}%`;
        $('allocBar').className = left < 0 ? 'danger' : '';
      }
      renderCategoryLimits(month, false);
      renderBudgetComparison(month);
    }

    if (viewMode === 'global') {
      $('budgetModeGuide').innerHTML = monthlyBudget > 0
        ? `<span><strong>Budget mensuel : ${money(monthlyBudget)}</strong> · Non affecté : <b>${money(unallocated)}</b></span>`
        : `<span><strong>Définir un budget mensuel</strong> · Non affecté disponible : <b>${money(unallocated)}</b></span>`;
    } else if (viewMode === 'category') {
      $('budgetModeGuide').innerHTML = catTotal > 0
        ? `<span><strong>Par catégorie : ${money(catTotal)}</strong> · Non affecté : <b>${money(unallocated)}</b></span>`
        : `<span><strong>Définir par catégorie</strong> · Non affecté disponible : <b>${money(unallocated)}</b></span>`;
    } else {
      $('budgetModeGuide').innerHTML = monthlyBudget > 0
        ? `<span><strong>Mensuel ${money(monthlyBudget)}</strong> · Réparti : <b>${money(catTotal)}</b> · Reste à répartir : <b>${money(Math.max(0, remainingToAllocate(month)))}</b></span>`
        : `<span><strong>Mensuel + catégories</strong> · Définissez d’abord le budget mensuel · Non affecté disponible : <b>${money(unallocated)}</b></span>`;
    }

    refreshIcons();
  }

  function renderCategoryLimits(month, locked = false) {
    const limits = categoryLimitsFor(month);
    const categories = Object.keys(limits).filter(category => amountNumber(limits[category]) > 0).sort((a, b) => a.localeCompare(b, 'fr'));
    $('categoryLimits').innerHTML = categories.map(category => {
      const limit = amountNumber(limits[category]), actual = categoryExpenses(category, month), remaining = limit - actual, percent = limit > 0 ? actual / limit * 100 : 0;
      const cls = percent >= 100 ? 'danger' : percent >= 80 ? 'warning' : '';
      const status = percent >= 100 ? 'Dépassée' : percent >= 80 ? 'À surveiller' : 'Respectée';
      const label = remaining >= 0 ? `Reste ${money(remaining)}` : `Dépassement ${money(Math.abs(remaining))}`;
      return `<div class="limit-row"><div class="limit-head"><div class="limit-row-name">${categoryIcon(category)}<span>${escapeHtml(category)}</span></div><span class="state-pill ${cls}">${status}</span></div><div class="limit-amount"><strong>${money(actual)}</strong><small>sur ${money(limit)} · ${Math.round(percent)} %</small></div><div class="progress-track"><span class="${cls}" style="width:${Math.min(100, percent)}%"></span></div><div class="limit-foot"><span class="limit-row-remaining ${remaining < 0 ? 'negative-value' : ''}">${label}</span><div class="limit-row-actions"><button class="table-action" data-set-limit="${escapeHtml(category)}" ${locked ? 'disabled' : ''}>Modifier</button><button class="table-action delete" data-remove-limit="${escapeHtml(category)}" ${locked ? 'disabled' : ''}>Supprimer</button></div></div></div>`;
    }).join('');
    $('limitsEmpty').hidden = categories.length > 0;
  }

  function renderBudgetComparison(month) {
    const limits = categoryLimitsFor(month);
    const categories = new Set([...Object.keys(limits), ...transactionsFor(month).filter(t => t.type === 'Dépense').map(t => t.category)]);
    const rows = [...categories].sort((a, b) => a.localeCompare(b, 'fr')).map(category => {
      const limit = amountNumber(limits[category]);
      const actual = categoryExpenses(category, month);
      const delta = limit ? limit - actual : null;
      const status = !limit ? [activeBudgetType(month) === 'mixed' ? 'Hors répartition' : 'Sans budget', ''] : actual >= limit ? ['Dépassée', 'danger'] : actual >= limit * .8 ? ['À surveiller', 'warning'] : ['Respectée', ''];
      return `<tr><td>${categoryIcon(category)} ${escapeHtml(category)}</td><td>${limit ? money(limit) : '—'}</td><td>${money(actual)}</td><td>${delta === null ? '—' : (delta < 0 ? '−' : '+') + money(Math.abs(delta))}</td><td>${limit ? `<div class="mini-bar"><span class="${status[1]}" style="width:${Math.min(100, actual / limit * 100)}%"></span></div>` : '—'}</td><td><span class="state-pill ${status[1]}">${status[0]}</span></td></tr>`;
    });
    $('budgetComparisonTable').innerHTML = rows.join('');
    $('comparisonEmpty').hidden = rows.length > 0;
  }

  function renderLimitPicker() {
    const month = selectedMonth(), limits = categoryLimitsFor(month), selected = $('limitCategory').value;
    const list = state.categories.map(c => ({ name: c.nomCategorie, icon: c.icone }));
    if (selected && !list.some(e => e.name === selected)) list.push({ name: selected, icon: 'circle-ellipsis' });
    $('limitCategoryPicker').innerHTML = list.map((entry, index) => {
      const active = entry.name === selected, hasLimit = amountNumber(limits[entry.name]) > 0;
      return `<div class="cat-tile-wrap"><button type="button" class="cat-tile ${active ? 'selected' : ''}" role="radio" aria-checked="${active}" data-limit-category="${escapeHtml(entry.name)}" title="${hasLimit ? 'Limite déjà définie : ' + money(limits[entry.name]) : 'Choisir ' + escapeHtml(entry.name)}"><span class="category-icon" style="--c:${ICON_COLORS[index % ICON_COLORS.length]}">${iconMarkup(entry.icon)}</span><span class="cat-name">${escapeHtml(entry.name)}</span>${hasLimit ? '<span class="limit-badge" aria-hidden="true">✓</span>' : ''}</button></div>`;
    }).join('');
    $('limitCategoryChosen').innerHTML = selected ? `Catégorie choisie : <strong>${escapeHtml(selected)}</strong>` : 'Touchez l’icône de la catégorie à budgétiser. ✓ = limite déjà définie.';
    refreshIcons();
  }
  // Mode mixte : indique à l'utilisateur ce qui reste à répartir (en tenant compte du montant saisi).
  function updateLimitHint() {
    const month = selectedMonth();
    const box = $('limitRemainingBox');
    if (activeBudgetType(month) !== 'mixed' || budgetFor(month) <= 0) { box.hidden = true; return; }
    const category = $('limitCategory').value;
    const left = remainingToAllocate(month, category);
    const typed = Number($('limitAmount').value);
    const after = Number.isFinite(typed) && typed > 0 ? left - typed : null;
    let text = `Budget mensuel ${money(budgetFor(month))} · Il vous reste <strong>${money(Math.max(0, left))}</strong> à répartir${category ? ` (hors « ${escapeHtml(category)} »)` : ''}.`;
    if (after !== null) text += after >= 0 ? ` Après ce budget : <strong>${money(after)}</strong> restants.` : ` <strong class="negative-value">Dépasse de ${money(-after)}.</strong>`;
    $('limitRemainingText').innerHTML = text;
    $('limitUseRemaining').hidden = left <= 0;
    box.hidden = false;
  }
  function openLimitDialog(category = '') {
    const month = selectedMonth();
    const mode = activeBudgetType(month);
    if (mode === 'global') {
      showError('Passez en mode « Par catégorie » ou « Mensuel + catégories » pour définir des budgets par catégorie.', 'Mode mensuel seul');
      return;
    }
    if (mode === 'mixed' && budgetFor(month) <= 0) {
      showError('Définissez d’abord le budget mensuel, puis répartissez-le entre vos catégories.', 'Budget mensuel requis');
      return;
    }
    const limits = categoryLimitsFor(month);
    $('limitCategory').value = category || '';
    $('limitAmount').value = category ? amountNumber(limits[category]) || '' : '';
    renderLimitPicker();
    updateLimitHint();
    $('limitDialog').showModal();
  }

  function buildAlertMessages(month) {
    const messages = [];
    const budget = budgetFor(month), actual = expensesFor(month);
    if (budget && actual > budget) messages.push(`Budget mensuel dépassé de ${money(actual - budget)}.`);
    else if (budget && actual >= budget * 0.8) messages.push(`Budget utilisé à ${Math.round(actual / budget * 100)} %.`);

    for (const [category, limitValue] of Object.entries(categoryLimitsFor(month))) {
      const limit = amountNumber(limitValue);
      const spent = categoryExpenses(category, month);
      if (limit && spent > limit) messages.push(`Budget ${category} dépassé de ${money(spent - limit)}.`);
      else if (limit && spent >= limit * 0.8) messages.push(`Budget ${category} utilisé à ${Math.round(spent / limit * 100)} %.`);
    }

    if (unallocatedFunds() < 0) {
      messages.push(cumulativeBalance() < 0
        ? `Solde négatif (${money(cumulativeBalance())}) : vos dépenses dépassent vos revenus.`
        : `Argent non affecté négatif (${money(unallocatedFunds())}) : l’épargne et le budget dépassent votre solde.`);
    }

    state.transactions.filter(t => t.type === 'Dépense' && t.unusual && t.date?.slice(0, 7) === month)
      .forEach(t => messages.push(t.unusualReason || `Dépense inhabituelle : ${t.category}, ${money(t.amount)}.`));

    // Alertes sur les dates limites des objectifs d'épargne non atteints
    const todayStr = localDate();
    state.goals.forEach(goal => {
      const target = amountNumber(goal.target);
      const saved = amountNumber(goal.saved);
      if (!goal.deadline || saved >= target) return;
      const days = Math.ceil((new Date(goal.deadline + 'T00:00:00') - new Date(todayStr + 'T00:00:00')) / 864e5);
      const remaining = Math.max(0, target - saved);
      if (days < 0) {
        messages.push(`Échéance dépassée pour l’objectif « ${goal.name} » (${formatDate(goal.deadline)} · reste ${money(remaining)}).`);
      } else if (days === 0) {
        messages.push(`Échéance aujourd’hui pour l’objectif « ${goal.name} » (reste ${money(remaining)}).`);
      } else if (days <= 7) {
        messages.push(`Échéance proche (${days} j) pour l’objectif « ${goal.name} » (reste ${money(remaining)}).`);
      }
    });

    return [...new Set(messages)];
  }

  // ---------- Notifications ----------
  function alertLevel(message) { return /dépass|insuffisant|inhabituelle|importante|échéance dépassée|aujourd’hui/i.test(message) ? 'danger' : 'warning'; }
  function unreadAlerts(month) { const read = state.readAlerts || []; return buildAlertMessages(month).filter(m => !read.includes(m)); }
  function renderNotifications() {
    const month = selectedMonth(), read = state.readAlerts || [], alerts = buildAlertMessages(month);
    $('notifList').innerHTML = alerts.length ? alerts.map(m => { const level = alertLevel(m), isNew = !read.includes(m); return `<article class="notif-item ${level} ${isNew ? 'unread' : ''}"><span class="notif-icon">${icon(level === 'danger' ? 'alert-triangle' : 'alert-circle')}</span><p>${escapeHtml(m)}</p>${isNew ? '<span class="notif-new">Nouveau</span>' : ''}</article>`; }).join('')
      : `<div class="notif-empty">${icon('circle-check')}<strong>Aucune alerte</strong><span>${monthLabel(month)}</span></div>`;
    $('notifReadAll').disabled = unreadAlerts(month).length === 0;
    refreshIcons();
  }

  // ---------- Épargne ----------
  function fillGoalCategories() {
    const selected = $('goalCategory').value;
    const list = entriesFor('Dépense');
    const known = list.some(e => e.name === selected);
    if (!known) $('goalCategory').value = '';
    const tiles = list.map((entry, index) => {
      const color = ICON_COLORS[index % ICON_COLORS.length];
      const active = entry.name === $('goalCategory').value;
      return `<div class="cat-tile-wrap"><button type="button" class="cat-tile ${active ? 'selected' : ''}" role="radio" aria-checked="${active}" data-goal-category="${escapeHtml(entry.name)}"><span class="category-icon" style="--c:${color}">${iconMarkup(entry.icon)}</span><span class="cat-name">${escapeHtml(entry.name)}</span></button>${entry.custom ? `<button type="button" class="cat-remove" data-remove-goal-category="${escapeHtml(entry.name)}" aria-label="Supprimer ${escapeHtml(entry.name)}">×</button>` : ''}</div>`;
    });
    tiles.push(`<div class="cat-tile-wrap"><button type="button" class="cat-tile add-tile" id="goalAddCategoryTile"><span class="category-icon" style="--c:#999">${iconMarkup('plus')}</span><span class="cat-name">Nouvelle</span></button></div>`);
    $('goalCategoryPicker').innerHTML = tiles.join('');
    refreshIcons();
  }

  function resetGoalNewCategoryPanel() {
    goalNewCategoryIcon = '';
    $('goalNewCategoryName').value = '';
    $('goalNewCategoryIconFile').value = '';
    $('goalNewCategoryIconPreview').innerHTML = '<i data-lucide="image-plus"></i>';
    $('goalNewCategoryPanel').hidden = true;
    refreshIcons();
  }

  function saveGoalNewCategory() {
    const name = $('goalNewCategoryName').value.trim();
    if (!name) { showError('Nom requis.'); return; }
    if (!goalNewCategoryIcon) { showError('Icône requise.'); return; }
    const list = entriesFor('Dépense');
    if (list.some(e => e.name.toLowerCase() === name.toLowerCase())) { showError('Nom déjà utilisé.'); return; }
    const id = state.categories.reduce((m, c) => Math.max(m, c.idCategorie), 0) + 1;
    state.categories.push({ idCategorie: id, nomCategorie: name, icone: goalNewCategoryIcon, custom: true });
    if (!saveState()) return;
    $('goalCategory').value = name;
    resetGoalNewCategoryPanel();
    fillGoalCategories();
    toast('Catégorie ajoutée.');
  }

 

 function goalCard(goal, completed = false) {
    const target = amountNumber(goal.target);
    const saved = amountNumber(goal.saved);
    const pct = target > 0 ? Math.min(100, saved / target * 100) : 0;
    const remainingAmount = Math.max(0, target - saved);
    const overdue = goal.deadline && goal.deadline < localDate() && !completed;
    const days = goal.deadline
      ? Math.ceil((new Date(goal.deadline + 'T00:00:00') - new Date(localDate() + 'T00:00:00')) / 864e5)
      : null;

    const status = completed
      ? 'Terminée'
      : overdue
        ? 'Échéance dépassée'
        : goal.deadline
          ? (days === 0 ? 'Aujourd’hui' : `${days} j restants`)
          : 'Sans échéance';

    const tone = completed ? 'done' : overdue ? 'late' : (days !== null && days <= 7 ? 'late' : '');
    const monthly = !completed && days > 0 && remainingAmount > 0
      ? money(Math.ceil(remainingAmount / Math.max(1, Math.ceil(days / 30))))
      : '—';

    const del = `<button class="delete-goal" data-goal-delete="${goal.id}">${icon('trash-2')} Supprimer</button>`;
    const edit = `<button data-goal-edit="${goal.id}">${icon('pencil')} Modifier</button>`;
    const actions = completed
      ? `${edit}${del}`
      : `<button class="goal-add" data-goal-add="${goal.id}">${icon('plus')} Ajouter</button><button data-goal-remove="${goal.id}">${icon('minus')} Retirer</button>${edit}${del}`;

    const catBadge = goal.category
      ? `<span class="goal-cat-tag">${categoryIcon(goal.category)} ${escapeHtml(goal.category)}</span>`
      : '';
    const descHtml = goal.description
      ? `<p class="muted small" style="margin-top:4px;">${escapeHtml(goal.description)}</p>`
      : '';

    const progressDetailsHtml = completed
      ? `<div class="progress-track"><span class="done" style="width:100%;background:var(--green);"></span></div>
         <small class="muted small">Objectif complété à 100 % (${money(target)} atteints)</small>`
      : `<div class="progress-track"><span class="${overdue ? 'danger' : ''}" style="width:${pct}%"></span></div>
         <small class="muted small">Avancement : <strong>${pct.toFixed(1).replace(/\.0$/, '')} %</strong> · Reste <strong>${money(remainingAmount)}</strong></small>`;

    return `
      <article class="goal-card ${completed ? 'completed' : ''}">
        <div class="goal-main">
          <div class="goal-ring" style="--p:${pct}"><span>${Math.round(pct)} %</span></div>
          <div class="goal-info">
            ${catBadge}
            <strong>${escapeHtml(goal.name)}</strong>
            <small class="goal-chip ${tone}">${status}</small>
            ${descHtml}
            <div class="goal-amount">${money(saved)} <small>sur ${money(target)}</small></div>
            <div style="margin-top:8px;">${progressDetailsHtml}</div>
          </div>
        </div>
        <div class="goal-stats">
          <div><small>Reste</small><b>${completed ? '0 DA' : money(remainingAmount)}</b></div>
          <div><small>Par mois</small><b>${monthly}</b></div>
          <div><small>Échéance</small><b>${goal.deadline ? formatDate(goal.deadline) : '—'}</b></div>
        </div>
        <div class="goal-actions">${actions}</div>
      </article>
    `;
  }

  function renderSavings() {
    const activeGoals = state.goals.filter(goal => amountNumber(goal.saved) < amountNumber(goal.target));
    const completedGoals = state.goals.filter(goal => amountNumber(goal.saved) >= amountNumber(goal.target));

    const totalSavedAll = totalSavedGoals();
    const activeSaved = activeGoals.reduce((total, goal) => total + amountNumber(goal.saved), 0);
    const activeTarget = activeGoals.reduce((total, goal) => total + amountNumber(goal.target), 0);
    const activeRemaining = Math.max(0, activeTarget - activeSaved);

    $('savingsOverview').innerHTML = `
      <div><small>Total épargné</small><strong>${money(totalSavedAll)}</strong></div>
      <div><small>Épargnes en cours</small><strong>${activeGoals.length}</strong></div>
      <div><small>Reste à épargner</small><strong>${money(activeRemaining)}</strong></div>
    `;

    const sortedActive = [...activeGoals].sort((a, b) => (a.deadline || '9999').localeCompare(b.deadline || '9999'));
    const next = sortedActive.find(g => g.deadline && g.deadline >= localDate());
    const gp = activeTarget > 0 ? Math.round(activeSaved / activeTarget * 100) : 0;

    $('savingsSummary').hidden = activeGoals.length === 0;
    $('savingsSummary').innerHTML = `
      <div class="panel-heading">
        <h2>Avancement des épargnes non terminées</h2>
        <strong class="sum-pct">${gp} %</strong>
      </div>
      <div class="progress-track large"><span style="width:${gp}%;background:var(--yellow)"></span></div>
      <div class="progress-caption">
        <span>${money(activeSaved)} épargnés sur ${money(activeTarget)} (reste ${money(activeRemaining)})</span>
        <span>${next ? `Prochaine échéance : ${escapeHtml(next.name)} (${formatDate(next.deadline)})` : ''}</span>
      </div>
    `;

    // 1. Épargnes non terminées (en haut)
    const grouped = new Map();
    sortedActive.forEach(goal => {
      const catKey = (goal.category || '').trim() || 'Sans catégorie';
      if (!grouped.has(catKey)) grouped.set(catKey, []);
      grouped.get(catKey).push(goal);
    });

    const orderedCategories = [...grouped.keys()].sort((a, b) => {
      if (a === 'Sans catégorie') return 1;
      if (b === 'Sans catégorie') return -1;
      return a.localeCompare(b, 'fr');
    });

    $('goalsByCategory').innerHTML = orderedCategories.map(cat => {
      const goalsInCat = grouped.get(cat);
      const catSaved = goalsInCat.reduce((s, g) => s + amountNumber(g.saved), 0);
      const catTarget = goalsInCat.reduce((s, g) => s + amountNumber(g.target), 0);
      const catPct = catTarget > 0 ? Math.round(catSaved / catTarget * 100) : 0;
      const headerIcon = cat === 'Sans catégorie' ? icon('folder') : categoryIcon(cat);
      return `
        <div class="panel" style="margin-bottom: 16px;">
          <div class="panel-heading">
            <div style="display:flex;align-items:center;gap:10px;">
              ${headerIcon}
              <div>
                <h3 style="margin:0;font-size:1rem;">${escapeHtml(cat)}</h3>
                <small class="muted">${goalsInCat.length} en cours · ${catPct} % (${money(catSaved)} / ${money(catTarget)})</small>
              </div>
            </div>
          </div>
          <div class="goal-grid">${goalsInCat.map(goal => goalCard(goal, false)).join('')}</div>
        </div>
      `;
    }).join('');

    $('goalsEmpty').hidden = activeGoals.length > 0;

    // 2. Épargnes terminées (en dessous)
    const sortedCompleted = [...completedGoals].sort((a, b) => (b.deadline || '').localeCompare(a.deadline || ''));
    $('completedGoalsGrid').innerHTML = sortedCompleted.map(goal => goalCard(goal, true)).join('');
    $('completedGoalsEmpty').hidden = completedGoals.length > 0;
    $('completedGoalsCount').textContent = `${completedGoals.length} terminée${completedGoals.length > 1 ? 's' : ''}`;
    $('completedGoalsSection').hidden = completedGoals.length === 0;

    refreshIcons();
  }

  function openGoalMovement(goalId, type) {
    const goal = state.goals.find(g => g.id === goalId);
    if (!goal) return;
    const remainingToTarget = Math.max(0, amountNumber(goal.target) - amountNumber(goal.saved));
    const availableUnallocated = Math.max(0, unallocatedFunds());
    $('movementGoalId').value = goalId;
    $('movementType').value = type;
    $('goalMovementTitle').textContent = type === 'add' ? `Ajouter · ${goal.name}` : `Retirer · ${goal.name}`;
    $('movementAmount').value = '';
    $('movementDate').value = '';
    $('movementDate').max = localDate();
    $('goalMovementHint').textContent = type === 'add'
      ? `Reste avant cible : ${money(remainingToTarget)} · Argent non affecté disponible : ${money(availableUnallocated)}`
      : `Épargne disponible sur cet objectif : ${money(goal.saved)}`;
    $('goalMovementDialog').showModal();
  }

  // ---------- Statistiques ----------
  // Période des statistiques : « Mois » = mois choisi en haut, « 3 derniers mois » = ce mois et les 2 précédents,
  // « Année » = les 12 mois de l'année du mois choisi.
  let statsRange = 'month';
  const RANGE_TEXT = {
    month: { income: 'Revenus du mois', expenses: 'Dépenses du mois' },
    quarter: { income: 'Revenus (3 mois)', expenses: 'Dépenses (3 mois)' },
    year: { income: 'Revenus de l’année', expenses: 'Dépenses de l’année' }
  };
  function statsMonths() {
    const [year, monthNumber] = selectedMonth().split('-').map(Number);
    if (statsRange === 'year') return Array.from({ length: 12 }, (_, i) => `${year}-${String(i + 1).padStart(2, '0')}`);
    const count = statsRange === 'quarter' ? 3 : 1;
    return Array.from({ length: count }, (_, i) => localMonth(new Date(year, monthNumber - 1 - (count - 1 - i), 1)));
  }
  function statsPeriodText(months) {
    if (statsRange === 'year') return `année ${months[0].slice(0, 4)}`;
    if (months.length === 1) return monthLabel(months[0]);
    return `${monthLabel(months[0])} – ${monthLabel(months[months.length - 1])}`;
  }
  function renderStats() {
    const months = statsMonths();
    const periodData = months.flatMap(m => transactionsFor(m));
    const income = sumTransactions(periodData, 'Revenu');
    const expenses = sumTransactions(periodData, 'Dépense');
    const balance = income - expenses;
    const text = RANGE_TEXT[statsRange];
    document.querySelectorAll('.range-option').forEach(button => {
      const active = button.dataset.range === statsRange;
      button.classList.toggle('active', active);
      button.setAttribute('aria-pressed', String(active));
    });
    $('statsPeriodLabel').textContent = statsPeriodText(months);
    $('statsKpis').innerHTML = `<div class="stats-kpi"><small>Différence</small><strong>${money(balance)}</strong></div><div class="stats-kpi"><small>${text.income}</small><strong class="income-text">${money(income)}</strong></div><div class="stats-kpi"><small>${text.expenses}</small><strong class="expense-text">${money(expenses)}</strong></div>`;
    renderCategoryDonut(months);
    renderIncomeExpenseChart(income, expenses);
    renderMonthlyChart(selectedMonth());
    renderUnusualTransactions();
  }
  function renderCategoryDonut(months) {
    const map = new Map();
    months.flatMap(m => transactionsFor(m)).filter(t => t.type === 'Dépense').forEach(t => map.set(t.category, (map.get(t.category) || 0) + amountNumber(t.amount)));
    const entries = [...map.entries()].sort((a, b) => b[1] - a[1]);
    const total = entries.reduce((sum, entry) => sum + entry[1], 0);
    $('donutTotal').textContent = money(total);
    let cursor = 0;
    const slices = entries.map(([category, value], index) => {
      const start = cursor; cursor += total ? value / total * 100 : 0;
      return `${CHART_COLORS[index % CHART_COLORS.length]} ${start}% ${cursor}%`;
    });
    $('categoryDonut').style.background = entries.length ? `conic-gradient(${slices.join(',')})` : 'conic-gradient(#353535 0 100%)';
    $('categoryLegend').innerHTML = entries.map(([category, value], index) => `<div class="donut-legend-row"><i style="background:${CHART_COLORS[index % CHART_COLORS.length]}"></i>${categoryIcon(category)} <span>${escapeHtml(category)}</span><b>${Math.round(value / total * 100)}%</b></div>`).join('');
    $('categoryChartEmpty').hidden = entries.length > 0;
  }
  function renderIncomeExpenseChart(income, expenses) {
    const max = Math.max(income, expenses, 1);
    $('incomeExpenseChart').innerHTML = [
      { label: 'Revenus', value: income, cls: 'income' },
      { label: 'Dépenses', value: expenses, cls: 'expense' }
    ].map(item => `<div class="ie-column"><strong>${money(item.value)}</strong><div class="bar ${item.cls}" style="height:${Math.max(item.value ? 3 : 1, item.value / max * 125)}px"></div><small>${item.label}</small></div>`).join('');
    $('incomeExpenseEmpty').hidden = income + expenses > 0;
  }
  function renderUnusualTransactions() {
    const unusual = [...state.transactions].filter(t => t.type === 'Dépense' && t.unusual).sort((a, b) => b.date.localeCompare(a.date) || (b.createdAt || 0) - (a.createdAt || 0));
    $('unusualTransactions').innerHTML = unusual.map(t => `<article class="unusual-row"><div class="unusual-icon">${icon('alert-triangle')}</div><div class="unusual-content"><strong>${escapeHtml(t.category)} · ${money(t.amount)}</strong><p>${escapeHtml(t.unusualReason || 'Montant inhabituel.')}</p><small>${formatDate(t.date)}${t.description ? ' · ' + escapeHtml(t.description) : ''}</small></div><button class="confirm-normal" data-confirm-normal="${t.id}">Confirmer normale</button></article>`).join('');
    $('unusualEmpty').hidden = unusual.length > 0;
    $('unusualCount').textContent = unusual.length;
    refreshIcons();
  }

  function renderMonthlyChart(month) {
    const [year, monthNumber] = month.split('-').map(Number);
    const isYear = statsRange === 'year';
    const count = isYear ? 12 : 6;
    // Année : janvier → décembre ; sinon les 6 mois qui se terminent au mois choisi.
    const base = isYear ? new Date(year, 11, 1) : new Date(year, monthNumber - 1, 1);
    const values = [];
    $('monthlyChartSubtitle').textContent = isYear ? `Année ${year}` : '6 derniers mois';
    for (let offset = count - 1; offset >= 0; offset--) {
      const date = new Date(base.getFullYear(), base.getMonth() - offset, 1);
      const key = localMonth(date);
      values.push({ label: date.toLocaleDateString('fr-FR', { month: 'short' }), value: expensesFor(key) });
    }
    const max = Math.max(1, ...values.map(item => item.value));
    $('monthlyExpenseChart').innerHTML = values.map(item => `<div class="month-col"><strong>${item.value ? moneyShort(item.value) : ''}</strong><div class="bar" style="height:${Math.max(item.value ? 3 : 1, item.value / max * 130)}px" title="${money(item.value)}"></div><small>${item.label}</small></div>`).join('');
  }
  function moneyShort(value) {
    if (value >= 1000000) return `${(value / 1000000).toFixed(1)}M`;
    if (value >= 1000) return `${Math.round(value / 1000)}k`;
    return String(Math.round(value));
  }

  // ---------- Paramètres / exports ----------
  function renderSettings() { $('profileName').value = state.profileName || ''; }
  function downloadFile(content, fileName, mimeType) {
    const blob = new Blob([content], { type: mimeType });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url; anchor.download = fileName; anchor.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  function exportCsv() {
    const rows = [['Date', 'Type', 'Catégorie', 'Description', 'Montant (DA)'], ...state.transactions.map(t => [t.date, t.type, t.category, t.description || '', t.amount])];
    const csv = '\uFEFF' + rows.map(row => row.map(value => `"${String(value ?? '').replace(/"/g, '""')}"`).join(';')).join('\r\n');
    downloadFile(csv, 'ecobudget-transactions.csv', 'text/csv;charset=utf-8');
    toast('Export CSV préparé.');
  }
  function makeId() { return (window.crypto && crypto.randomUUID) ? crypto.randomUUID() : `id-${Date.now()}-${Math.random().toString(16).slice(2)}`; }
  function renderAll() {
    renderHome(); renderTransactions(); renderBudget(); renderSavings(); renderStats(); renderSettings(); refreshIcons();
  }

  function clearMonthBudgets(month) {
    delete state.monthlyBudgets[month];
    delete state.monthlyCategoryLimits[month];
    setBudgetMode(month, 'none');
    saveState();
    renderAll();
    toast('Budget retiré.');
  }

  // ---------- Evénements ----------
  document.querySelectorAll('[data-page]').forEach(button => button.addEventListener('click', event => {
    event.preventDefault(); navigate(button.dataset.page);
  }));
  $('settingsNav').addEventListener('click', () => navigate('settings'));
  async function logout() {
    // attend la fin des enregistrements en cours pour ne rien perdre
    for (let i = 0; (saving || dirty) && i < 40; i += 1) await new Promise(resolve => setTimeout(resolve, 50));
    try {
      await fetch('/api/auth/logout', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
    } catch (error) {
      console.error(error);
      showError('Déconnexion impossible : serveur injoignable.');
      return;
    }
    goToLogin();
  }
  $('logoutNav').addEventListener('click', logout);
  $('logoutButton').addEventListener('click', logout);
  $('profileButton').addEventListener('click', () => navigate('settings'));
  $('themeToggle').addEventListener('click', () => applyTheme(currentTheme === 'dark' ? 'light' : 'dark', true));
  $('addTransactionHome').addEventListener('click', () => openTransactionDialog());
  $('addTransactionExpenses').addEventListener('click', () => openTransactionDialog());
  document.querySelectorAll('.type-option').forEach(btn => btn.addEventListener('click', () => {
    if ($('transactionType').value === btn.dataset.type) return;
    setTransactionType(btn.dataset.type);
    $('transactionCategory').value = '';
    resetNewCategoryPanel();
    fillCategories();
  }));
  $('categoryPicker').addEventListener('click', event => {
    const remove = event.target.closest('[data-remove-category]');
    if (remove) { removeCustomCategory(remove.dataset.removeCategory); return; }
    if (event.target.closest('#addCategoryTile')) { openNewCategoryPanel(); return; }
    const tile = event.target.closest('[data-category]');
    if (!tile) return;
    $('transactionCategory').value = tile.dataset.category;
    fillCategories();
  });
  $('newCategoryIconButton').addEventListener('click', () => $('newCategoryIconFile').click());
  $('newCategoryIconFile').addEventListener('change', async () => {
    const file = $('newCategoryIconFile').files[0];
    if (!file) return;
    try {
      newCategoryIcon = await importIconFile(file);
      $('newCategoryIconPreview').innerHTML = `<img src="${newCategoryIcon}" alt="" class="custom-icon-img">`;
    } catch (error) { newCategoryIcon = ''; showError(error.message); }
  });
  $('newCategorySave').addEventListener('click', saveNewCategory);
  $('newCategoryCancel').addEventListener('click', resetNewCategoryPanel);
  $('newCategoryName').addEventListener('keydown', event => { if (event.key === 'Enter') { event.preventDefault(); saveNewCategory(); } });
  $('transactionForm').addEventListener('submit', saveTransaction);
  $('monthFilter').addEventListener('change', () => {
    renderHome();
    renderBudget();
    renderStats();
  });
  document.querySelectorAll('.range-option').forEach(button => button.addEventListener('click', () => {
    statsRange = button.dataset.range;
    renderStats();
  }));
  $('pagePrev').addEventListener('click', () => { transactionPage--; renderTransactions(); });
  $('pageNext').addEventListener('click', () => { transactionPage++; renderTransactions(); });
  $('expenseTypeFilter').addEventListener('change', () => {
    $('expenseEntryFilter').value = 'Tous';
    renderTransactions();
  });
  $('expenseEntryFilter').addEventListener('change', () => {
    renderTransactions();
  });
  $('expenseDateFilter').addEventListener('change', () => {
    renderTransactions();
  });
  $('clearExpenseFilters').addEventListener('click', () => {
    $('expenseTypeFilter').value = 'Tous';
    $('expenseEntryFilter').value = 'Tous';
    $('expenseDateFilter').value = '';
    renderTransactions();
  });
  $('recentTransactions').addEventListener('click', event => {
    const editId = event.target.closest('[data-edit-transaction]')?.dataset.editTransaction;
    const deleteId = event.target.closest('[data-delete-transaction]')?.dataset.deleteTransaction;
    if (editId) {
      const transaction = state.transactions.find(t => t.id === editId);
      if (transaction) openTransactionDialog(transaction);
    }
    if (deleteId) deleteTransaction(deleteId);
  });
  $('transactionsTable').addEventListener('click', event => {
    const editId = event.target.closest('[data-edit-transaction]')?.dataset.editTransaction;
    const deleteId = event.target.closest('[data-delete-transaction]')?.dataset.deleteTransaction;
    if (editId) {
      const transaction = state.transactions.find(t => t.id === editId);
      if (transaction) openTransactionDialog(transaction);
    }
    if (deleteId) deleteTransaction(deleteId);
  });

  // Choix du mode de budget
  document.querySelectorAll('[data-budget-mode]').forEach(btn => {
    btn.addEventListener('click', async () => {
      const mode = btn.dataset.budgetMode;
      const month = selectedMonth();
      if (mode === activeBudgetType(month)) return;
      const hasMonthly = budgetFor(month) > 0;
      const hasLimits = totalCategoryLimitsFor(month) > 0;
      const label = monthLabel(month);

      // Ce qui serait perdu par le changement de mode → confirmation
      let confirmation = null;
      if (mode === 'none' && (hasMonthly || hasLimits)) {
        confirmation = ['Retirer le budget ?', `Supprimer le budget de ${label} ?`];
      } else if (mode === 'global' && hasLimits) {
        confirmation = ['Passer au budget mensuel seul ?', `Les budgets par catégorie de ${label} seront supprimés${hasMonthly ? ' (le budget mensuel est conservé)' : ''}.`];
      } else if (mode === 'category' && hasMonthly) {
        confirmation = ['Passer aux catégories seules ?', `Le budget mensuel de ${label} sera supprimé${hasLimits ? ' (les budgets par catégorie sont conservés)' : ''}.`];
      }
      if (confirmation && !(await askConfirmation(confirmation[0], confirmation[1]))) return;

      if (mode === 'none' || mode === 'global') delete state.monthlyCategoryLimits[month];
      if (mode === 'none' || mode === 'category') delete state.monthlyBudgets[month];
      setBudgetMode(month, mode);
      saveState();
      renderAll();
    });
  });

  // Supprime le budget mensuel : en mode mixte, les limites par catégorie sont conservées (on passe en « catégories seules »).
  async function removeMonthlyBudget() {
    const month = selectedMonth();
    const mixedWithLimits = activeBudgetType(month) === 'mixed' && totalCategoryLimitsFor(month) > 0;
    const accepted = await askConfirmation(
      'Supprimer le budget mensuel ?',
      mixedWithLimits
        ? `Supprimer le budget mensuel de ${monthLabel(month)} ? Les budgets par catégorie sont conservés (mode « Par catégorie »).`
        : `Supprimer le budget de ${monthLabel(month)} ?`
    );
    if (!accepted) return;
    delete state.monthlyBudgets[month];
    setBudgetMode(month, mixedWithLimits ? 'category' : 'none');
    saveState();
    renderAll();
    toast('Budget mensuel supprimé.');
  }

  $('monthlyBudgetForm').addEventListener('submit', async event => {
    event.preventDefault();
    const month = selectedMonth();
    const value = Number($('monthlyBudgetInput').value);

    if (!Number.isFinite(value) || value < 0) {
      showError('Montant invalide.');
      return;
    }

    if (value === 0) {
      if (budgetFor(month) > 0) await removeMonthlyBudget();
      return;
    }

    const allocated = totalCategoryLimitsFor(month);
    if (activeBudgetType(month) === 'mixed' && value < allocated) {
      showError(
        `Le budget mensuel (${money(value)}) ne peut pas être inférieur au total déjà réparti entre les catégories (${money(allocated)}).`,
        'Budget inférieur à la répartition'
      );
      return;
    }

    const availableUnallocated = cumulativeBalance() - totalSavedGoals();
    const newReserved = Math.max(0, value - expensesFor(month));

    if (newReserved > availableUnallocated) {
      const manque = newReserved - availableUnallocated;
      showError(
        `Argent non affecté insuffisant : manque ${money(manque)} (disponible : ${money(Math.max(0, availableUnallocated))}).`,
        'Argent non affecté insuffisant'
      );
      return;
    }

    state.monthlyBudgets[month] = value;
    if (activeBudgetType(month) === 'none') setBudgetMode(month, 'global');
    saveState();
    renderAll();
    toast('Budget mensuel enregistré.');
  });

  $('clearMonthlyBudget').addEventListener('click', removeMonthlyBudget);

  $('addCategoryLimit').addEventListener('click', () => openLimitDialog());
  $('limitAmount').addEventListener('input', updateLimitHint);
  $('limitUseRemaining').addEventListener('click', () => {
    const left = remainingToAllocate(selectedMonth(), $('limitCategory').value);
    if (left > 0) $('limitAmount').value = left;
    updateLimitHint();
  });
  $('limitCategoryPicker').addEventListener('click', event => {
    const tile = event.target.closest('[data-limit-category]');
    if (!tile) return;
    const name = tile.dataset.limitCategory;
    $('limitCategory').value = name;
    const existing = amountNumber(categoryLimitsFor(selectedMonth())[name]);
    if (existing > 0 && !$('limitAmount').value) $('limitAmount').value = existing;
    renderLimitPicker();
    updateLimitHint();
    $('limitAmount').focus({ preventScroll: true });
  });
  $('limitForm').addEventListener('submit', event => {
    event.preventDefault();
    const month = selectedMonth();
    const mode = activeBudgetType(month);
    const category = $('limitCategory').value;
    if (!category) { showError('Touchez l’icône d’une catégorie pour choisir celle à budgétiser.', 'Catégorie manquante'); return; }
    const limit = Number($('limitAmount').value);
    if (!Number.isFinite(limit) || limit <= 0) {
      showError('Montant invalide.');
      return;
    }

    if (mode === 'global') {
      showError('Passez en mode « Par catégorie » ou « Mensuel + catégories » pour définir des budgets par catégorie.', 'Mode mensuel seul');
      return;
    }

    if (mode === 'mixed') {
      const monthly = budgetFor(month);
      if (monthly <= 0) { showError('Définissez d’abord le budget mensuel.', 'Budget mensuel requis'); return; }
      const left = remainingToAllocate(month, category);
      if (limit > left) {
        showError(
          `Il ne vous reste que ${money(Math.max(0, left))} à répartir sur votre budget mensuel de ${money(monthly)}. Réduisez ce budget de ${money(limit - Math.max(0, left))}, diminuez une autre catégorie ou augmentez le budget mensuel.`,
          'Budget mensuel dépassé'
        );
        return;
      }
    } else {
      const nextLimits = { ...categoryLimitsFor(month), [category]: limit };
      const availableUnallocated = cumulativeBalance() - totalSavedGoals();
      const newReservedByCategories = reservedBudgetRemaining(month, { mode: 'category', limits: nextLimits });

      if (newReservedByCategories > availableUnallocated) {
        const manque = newReservedByCategories - availableUnallocated;
        showError(
          `Argent non affecté insuffisant pour « ${category} » : manque ${money(manque)} (disponible : ${money(Math.max(0, availableUnallocated))}).`,
          'Argent non affecté insuffisant'
        );
        return;
      }
    }

    if (!state.monthlyCategoryLimits[month]) state.monthlyCategoryLimits[month] = {};
    state.monthlyCategoryLimits[month][category] = limit;
    if (mode === 'none') setBudgetMode(month, 'category');
    saveState();
    $('limitDialog').close();
    renderAll();
    const leftAfter = mode === 'mixed' ? remainingToAllocate(month) : null;
    toast(`Budget enregistré pour ${category}.${leftAfter !== null ? ` Reste à répartir : ${money(Math.max(0, leftAfter))}.` : ''}`);
  });

  $('clearAllCategoryLimits').addEventListener('click', async () => {
    const month = selectedMonth();
    const accepted = await askConfirmation('Effacer les budgets catégories ?', `Supprimer tous les budgets par catégorie de ${month ? monthLabel(month) : ''} ?`);
    if (!accepted) return;
    delete state.monthlyCategoryLimits[month];
    saveState();
    renderAll();
    toast('Budgets catégories supprimés.');
  });

  $('categoryLimits').addEventListener('click', async event => {
    const month = selectedMonth();
    const removeButton = event.target.closest('[data-remove-limit]');
    const editButton = event.target.closest('[data-set-limit]');
    if (editButton) { openLimitDialog(editButton.dataset.setLimit); return; }
    if (removeButton) {
      const category = removeButton.dataset.removeLimit;
      const accepted = await askConfirmation('Supprimer ce budget ?', `Supprimer le budget de « ${category} » ?`);
      if (!accepted) return;
      if (state.monthlyCategoryLimits[month]) {
        delete state.monthlyCategoryLimits[month][category];
        if (Object.keys(state.monthlyCategoryLimits[month]).length === 0) delete state.monthlyCategoryLimits[month];
      }
      saveState();
      renderAll();
      toast('Budget supprimé.');
    }
  });

  // ---------- Événements Épargne ----------
  function setGoalDialogMode(editing) {
    $('goalDialogTitle').textContent = editing ? 'Modifier l’objectif d’épargne' : 'Créer un objectif d’épargne';
    $('goalSubmitButton').textContent = editing ? 'Enregistrer' : 'Créer l’objectif';
    $('goalCreateOnlyFields').hidden = editing; // le montant épargné se gère avec « Ajouter » / « Retirer »
  }

  function openGoalEdit(goalId) {
    const goal = state.goals.find(g => g.id === goalId);
    if (!goal) return;
    $('goalForm').reset();
    $('goalEditId').value = goal.id;
    setGoalDialogMode(true);
    $('goalName').value = goal.name || '';
    $('goalCategory').value = goal.category || '';
    resetGoalNewCategoryPanel();
    fillGoalCategories();
    $('goalTarget').value = goal.target;
    $('goalDescription').value = goal.description || '';
    $('goalDeadline').value = goal.deadline || '';
    $('goalUnallocatedHint').textContent = `Déjà épargné : ${money(amountNumber(goal.saved))} (utilisez « Ajouter » ou « Retirer » pour changer ce montant).`;
    $('goalDialog').showModal();
  }

  $('createGoal').addEventListener('click', () => {
    $('goalForm').reset();
    $('goalEditId').value = '';
    setGoalDialogMode(false);
    $('goalSavingDate').max = localDate();
    $('goalCategory').value = '';
    resetGoalNewCategoryPanel();
    fillGoalCategories();
    const available = unallocatedFunds();
    $('goalUnallocatedHint').textContent = `Argent non affecté disponible : ${money(Math.max(0, available))}`;
    $('goalDialog').showModal();
  });

  $('goalCategoryPicker').addEventListener('click', async event => {
    const remove = event.target.closest('[data-remove-goal-category]');
    if (remove) {
      const name = remove.dataset.removeGoalCategory;
      const accepted = await askConfirmation('Supprimer cette catégorie ?', `Supprimer « ${name} » ?`);
      if (!accepted) return;
      state.categories = state.categories.filter(c => !(c.custom && c.nomCategorie === name));
      if ($('goalCategory').value === name) $('goalCategory').value = '';
      saveState();
      fillGoalCategories();
      return;
    }
    if (event.target.closest('#goalAddCategoryTile')) {
      $('goalNewCategoryPanel').hidden = false;
      $('goalNewCategoryPanel').scrollIntoView({ block: 'nearest' });
      $('goalNewCategoryName').focus();
      return;
    }
    const tile = event.target.closest('[data-goal-category]');
    if (!tile) return;
    // Toggle : cliquer à nouveau sur la catégorie sélectionnée permet de la désélectionner (facultative)
    const clicked = tile.dataset.goalCategory;
    $('goalCategory').value = ($('goalCategory').value === clicked) ? '' : clicked;
    fillGoalCategories();
  });

  $('goalNewCategoryIconButton').addEventListener('click', () => $('goalNewCategoryIconFile').click());
  $('goalNewCategoryIconFile').addEventListener('change', async () => {
    const file = $('goalNewCategoryIconFile').files[0];
    if (!file) return;
    try {
      goalNewCategoryIcon = await importIconFile(file);
      $('goalNewCategoryIconPreview').innerHTML = `<img src="${goalNewCategoryIcon}" alt="" class="custom-icon-img">`;
    } catch (error) { goalNewCategoryIcon = ''; showError(error.message); }
  });
  $('goalNewCategorySave').addEventListener('click', saveGoalNewCategory);
  $('goalNewCategoryCancel').addEventListener('click', resetGoalNewCategoryPanel);
  $('goalNewCategoryName').addEventListener('keydown', event => {
    if (event.key === 'Enter') { event.preventDefault(); saveGoalNewCategory(); }
  });

  $('goalForm').addEventListener('submit', event => {
    event.preventDefault();
    const name = $('goalName').value.trim();
    const category = $('goalCategory').value.trim();
    const target = Number($('goalTarget').value);
    const initialSavedRaw = $('goalInitialSaved').value.trim();
    const initialSaved = initialSavedRaw === '' ? 0 : Number(initialSavedRaw);
    const description = $('goalDescription').value.trim();
    const deadline = $('goalDeadline').value;
    const editId = $('goalEditId').value;

    if (editId) {
      const goal = state.goals.find(g => g.id === editId);
      if (!goal) { $('goalDialog').close(); return; }
      if (!name || !Number.isFinite(target) || target <= 0) { showError('Nom et montant cible requis.'); return; }
      if (target < amountNumber(goal.saved)) {
        showError(`Le montant cible (${money(target)}) ne peut pas être inférieur au montant déjà épargné (${money(amountNumber(goal.saved))}).`, 'Montant cible trop bas');
        return;
      }
      if (deadline && deadline !== goal.deadline && deadline < localDate()) { showError('Date limite déjà passée.'); return; }
      goal.name = name;
      goal.category = category;
      goal.target = target;
      goal.description = description;
      goal.deadline = deadline;
      saveState();
      $('goalDialog').close();
      renderAll();
      toast('Objectif modifié.');
      return;
    }

    const savingDate = $('goalSavingDate').value || localDate();
    if (savingDate > localDate()) { showError('La date de l’épargne ne peut pas être dans le futur.', 'Date invalide'); return; }

    if (!name || !Number.isFinite(target) || target <= 0) {
      showError('Nom et montant cible requis.');
      return;
    }
    if (!Number.isFinite(initialSaved) || initialSaved < 0) {
      showError('Montant réservé initial invalide.');
      return;
    }
    if (initialSaved > target) {
      showError(`Le montant réservé initial (${money(initialSaved)}) ne peut pas dépasser le montant cible (${money(target)}).`, 'Montant supérieur à la cible');
      return;
    }
    if (deadline && deadline < localDate()) {
      showError('Date limite déjà passée.');
      return;
    }

    // Vérification par rapport à l'argent non affecté disponible
    if (initialSaved > 0) {
      const availableUnallocated = unallocatedFunds();
      if (initialSaved > availableUnallocated) {
        const manque = initialSaved - Math.max(0, availableUnallocated);
        showError(
          `Argent non affecté insuffisant : manque ${money(manque)} (disponible : ${money(Math.max(0, availableUnallocated))}).`,
          'Argent non affecté insuffisant'
        );
        return;
      }
    }

    const history = initialSaved > 0 ? [{ type: 'add', amount: initialSaved, date: savingDate, createdAt: Date.now() }] : [];
    state.goals.push({
      id: makeId(),
      name,
      category,
      target,
      saved: initialSaved,
      description,
      deadline,
      createdAt: Date.now(),
      history
    });
    saveState();
    $('goalDialog').close();
    renderAll();
    navigate('savings');
    toast('Objectif créé.');
  });

  async function handleGoalGridClick(event) {
    const addId = event.target.closest('[data-goal-add]')?.dataset.goalAdd;
    const removeId = event.target.closest('[data-goal-remove]')?.dataset.goalRemove;
    const deleteId = event.target.closest('[data-goal-delete]')?.dataset.goalDelete;
    const editId = event.target.closest('[data-goal-edit]')?.dataset.goalEdit;
    if (editId) { openGoalEdit(editId); return; }
    if (deleteId) {
      const goal = state.goals.find(g => g.id === deleteId);
      if (!goal) return;
      const accepted = await askConfirmation('Supprimer cet objectif ?', `Supprimer « ${goal.name} » ?`);
      if (accepted) { state.goals = state.goals.filter(g => g.id !== deleteId); saveState(); renderAll(); toast('Objectif supprimé.'); }
      return;
    }
    const id = addId || removeId;
    if (id) openGoalMovement(id, addId ? 'add' : 'remove');
  }
  $('goalsByCategory').addEventListener('click', handleGoalGridClick);
  $('completedGoalsGrid').addEventListener('click', handleGoalGridClick);

  $('goalMovementForm').addEventListener('submit', event => {
    event.preventDefault();
    const goal = state.goals.find(g => g.id === $('movementGoalId').value);
    const amount = Number($('movementAmount').value);
    const type = $('movementType').value;
    if (!goal || !Number.isFinite(amount) || amount <= 0) {
      showError('Montant invalide.');
      return;
    }
    const movementDate = $('movementDate').value || localDate();
    if (movementDate > localDate()) { showError('La date de l’épargne ne peut pas être dans le futur.', 'Date invalide'); return; }

    const currentSaved = amountNumber(goal.saved);
    const target = amountNumber(goal.target);

    if (type === 'add') {
      // 1. Vérifier qu'on ne dépasse pas la cible de l'objectif
      const remainingToTarget = Math.max(0, target - currentSaved);
      if (amount > remainingToTarget) {
        showError(
          `Impossible d’ajouter plus que la cible : il reste ${money(remainingToTarget)} pour atteindre ${money(target)}.`,
          'Cible dépassée'
        );
        return;
      }

      // 2. Vérifier que l'argent non affecté est suffisant
      const availableUnallocated = unallocatedFunds();
      if (amount > availableUnallocated) {
        const manque = amount - Math.max(0, availableUnallocated);
        showError(
          `Argent non affecté insuffisant : manque ${money(manque)} (disponible : ${money(Math.max(0, availableUnallocated))}).`,
          'Argent non affecté insuffisant'
        );
        return;
      }
    }

    if (type === 'remove' && amount > currentSaved) {
      showError('Montant supérieur à l’épargne disponible.');
      return;
    }

    goal.saved = Math.max(0, currentSaved + (type === 'add' ? amount : -amount));
    if (!Array.isArray(goal.history)) goal.history = [];
    goal.history.push({ type, amount, date: movementDate, createdAt: Date.now() });
    saveState();
    $('goalMovementDialog').close();
    renderAll();
    toast(type === 'add' ? 'Ajouté à l’objectif.' : 'Retiré de l’objectif.');
  });

  $('unusualTransactions').addEventListener('click', event => {
    const id = event.target.closest('[data-confirm-normal]')?.dataset.confirmNormal;
    if (!id) return;
    const transaction = state.transactions.find(t => t.id === id);
    if (!transaction) return;
    transaction.unusual = false;
    transaction.unusualConfirmedNormal = true;
    transaction.unusualReason = '';
    saveState(); renderAll(); toast('Confirmée normale.');
  });
  $('exportCsv').addEventListener('click', exportCsv);
  $('backupJson').addEventListener('click', () => downloadFile(JSON.stringify(state, null, 2), 'ecobudget-sauvegarde.json', 'application/json'));
  $('profileForm').addEventListener('submit', event => {
    event.preventDefault();
    const name = $('profileName').value.trim();
    if (!name) { showError('Nom requis.'); return; }
    state.profileName = name;
    $('homeTitle').innerHTML = `Bonjour, <strong>${escapeHtml(name)}</strong>`;
    $('profileButton').textContent = name.split(/\s+/).slice(0, 2).map(part => part[0]).join('').toUpperCase();
    saveState(); toast('Profil enregistré.');
  });
  $('resetData').addEventListener('click', async () => {
    const accepted = await askConfirmation('Réinitialiser EcoBudget ?', 'Effacer toutes les données ?');
    if (!accepted) return;
    state = emptyState(); saveState(); renderAll(); navigate('home'); toast('Données réinitialisées.');
  });
  $('notificationsButton').addEventListener('click', () => { renderNotifications(); $('notificationsDialog').showModal(); });
  $('notifReadAll').addEventListener('click', () => { state.readAlerts = [...new Set([...(state.readAlerts || []), ...buildAlertMessages(selectedMonth())])]; saveState(); renderNotifications(); renderHome(); });
  document.querySelectorAll('[data-close]').forEach(button => button.addEventListener('click', () => $(button.dataset.close).close()));
  $('confirmAccept').addEventListener('click', () => finishConfirmation(true));
  $('confirmCancel').addEventListener('click', () => finishConfirmation(false));
  $('confirmDialog').addEventListener('cancel', event => { event.preventDefault(); finishConfirmation(false); });
  $('confirmDialog').addEventListener('click', event => { if (event.target === $('confirmDialog')) finishConfirmation(false); });
  $('messageClose').addEventListener('click', () => $('messageDialog').close());
  $('messageDialog').addEventListener('click', event => { if (event.target === $('messageDialog')) $('messageDialog').close(); });
  ['notificationsDialog', 'transactionDialog', 'goalDialog', 'goalMovementDialog', 'limitDialog'].forEach(id => {
    $(id).addEventListener('click', event => { if (event.target === $(id)) $(id).close(); });
  });

  // Initialisation (charge d'abord les données depuis data/data.json)
  async function init() {
    try {
      const me = await fetchCurrentUser();
      if (!me) return; // redirigé vers la page de connexion
      $('accountName').textContent = me.username;
      const result = await loadStateFromServer();
      if (!result) return;
      state = result.state;
      if (result.isNew && !result.fromLegacy && me.name) state.profileName = me.name; // nom choisi à l'inscription
      stateLoaded = true;
      if (result.isNew) saveState(); // crée le fichier de données du compte (et migre les anciennes données du navigateur)
    } catch (error) {
      console.error(error);
      showError('Impossible de charger les données depuis le serveur. Lancez « npm start » puis rechargez la page.', 'Serveur injoignable');
    }
    $('monthFilter').value = thisMonth;
    $('homeTitle').innerHTML = `Bonjour, <strong>${escapeHtml(state.profileName || 'Alif Reza')}</strong>`;
    const initials = (state.profileName || 'AR').trim().split(/\s+/).slice(0, 2).map(part => part[0]).join('').toUpperCase();
    $('profileButton').textContent = initials || 'AR';
    applyTheme(state.theme);
    renderAll();
    window.addEventListener('load', refreshIcons, { once: true });
  }
  init();
})();
