/**
 * llm-config.js — Modal de gestión de proveedores LLM
 * DataB Flow · Cleaning | Transformation | Governance · © 2026 mdmarein · GNU AGPLv3
 */

import { $, show, hide, esc, toast } from './utils.js';
import { t } from './i18n.js';

// ── Helpers internos ─────────────────────────────────────────
function _id() { return 'p' + Date.now().toString(36); }

function _truncate(str, max = 36) {
  return str && str.length > max ? str.slice(0, max) + '…' : str || '';
}

// ── API ──────────────────────────────────────────────────────
async function _loadProviders() {
  const res = await fetch('/api/ai-config');
  const data = await res.json();
  return Array.isArray(data.providers) ? data.providers : [];
}

async function _saveProviders(providers) {
  const res = await fetch('/api/ai-config', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ providers }),
  });
  return res.ok;
}

async function _testConnection(url) {
  try {
    const res = await fetch(`/api/ai/health?url=${encodeURIComponent(url)}`, {
      signal: AbortSignal.timeout(6000),
    });
    const data = await res.json();
    return data.ok === true;
  } catch {
    return false;
  }
}

// ── Modal open/close ─────────────────────────────────────────
export function closeLLMModal() {
  hide('llm-modal');
}

export async function openLLMModal() {
  show('llm-modal');
  $('llm-modal-body').innerHTML = '<div style="padding:20px;color:var(--t2);font-size:12px">Cargando…</div>';
  $('llm-modal-footer').innerHTML = '';
  $('btn-modal-close').onclick = closeLLMModal;
  $('llm-modal').onclick = e => { if (e.target === $('llm-modal')) closeLLMModal(); };

  const providers = await _loadProviders();
  _renderList(providers);
}

// ── Vista lista ───────────────────────────────────────────────
function _renderList(providers) {
  const body   = $('llm-modal-body');
  const footer = $('llm-modal-footer');

  if (!providers.length) {
    body.innerHTML = `<div class="prov-empty">${t('llm.no_providers')}<br>${t('llm.no_providers_hint')}</div>`;
  } else {
    body.innerHTML = `
      <table class="prov-table">
        <thead><tr>
          <th>Label</th><th>Model</th><th>Server URL</th><th></th>
        </tr></thead>
        <tbody>
          ${providers.map(p => `
            <tr data-id="${esc(p.id)}">
              <td class="prov-label">${esc(p.label)}</td>
              <td><span class="mono" style="font-size:11px">${esc(p.model)}</span></td>
              <td class="prov-url">${esc(_truncate(p.url, 40))}</td>
              <td>
                <div class="prov-actions">
                  <button class="btn btn-xs btn-g prov-edit" data-id="${esc(p.id)}">${t('llm.edit')}</button>
                  <button class="btn btn-xs btn-red prov-del"  data-id="${esc(p.id)}">${t('llm.delete')}</button>
                </div>
              </td>
            </tr>`).join('')}
        </tbody>
      </table>`;

    body.querySelectorAll('.prov-edit').forEach(btn => {
      btn.addEventListener('click', () => {
        const p = providers.find(x => x.id === btn.dataset.id);
        if (p) _renderForm(providers, p);
      });
    });

    body.querySelectorAll('.prov-del').forEach(btn => {
      btn.addEventListener('click', () => {
        const p = providers.find(x => x.id === btn.dataset.id);
        if (!p) return;
        const row = btn.closest('tr');
        if (!row) return;
        // Confirmación inline — reemplaza los botones de la fila con "¿Confirmar? [Sí] [No]"
        const actCell = row.querySelector('.prov-actions');
        actCell.innerHTML = `
          <span style="font-size:11px;color:var(--warn)">${t('llm.confirm_delete', p.label)}</span>
          <button class="btn btn-xs btn-red prov-del-confirm">${t('llm.yes')}</button>
          <button class="btn btn-xs btn-g prov-del-cancel">${t('llm.no')}</button>`;
        actCell.querySelector('.prov-del-confirm').addEventListener('click', async () => {
          const updated = providers.filter(x => x.id !== p.id);
          await _saveProviders(updated);
          toast(t('llm.provider_deleted'));
          _renderList(updated);
        });
        actCell.querySelector('.prov-del-cancel').addEventListener('click', () => _renderList(providers));
      });
    });
  }

  footer.innerHTML = `
    <button class="btn btn-g btn-sm" id="btn-prov-add">${t('llm.add_provider')}</button>
    <button class="btn btn-g btn-sm" id="btn-prov-close">${t('misc.modal_close')}</button>`;
  $('btn-prov-add').onclick   = () => _renderForm(providers, null);
  $('btn-prov-close').onclick = closeLLMModal;
}

// ── Vista form ────────────────────────────────────────────────
function _renderForm(providers, provider) {
  const isNew = !provider;
  const p = provider || {
    id: _id(), label: '', url: 'http://localhost:11434/v1/chat/completions',
    model: '', apiKey: 'ollama', temperature: 0.2, top_p: 0.9,
    seed: 42, maxTokens: 256, waitTime: 0,
  };

  $('llm-modal-body').innerHTML = `
    <div class="prov-form">
      <div class="prov-form-row">
        <div class="pf-group">
          <label class="pf-label">Label</label>
          <input class="pf-input" id="pf-label" value="${esc(p.label)}" placeholder="Ej: Llama3.1 Latest">
        </div>
        <div class="pf-group">
          <label class="pf-label">API Key</label>
          <input class="pf-input" id="pf-apiKey" value="${esc(p.apiKey)}" placeholder="ollama / sk-…">
        </div>
      </div>
      <div class="prov-form-row full">
        <div class="pf-group">
          <label class="pf-label">Server URL</label>
          <input class="pf-input" id="pf-url" value="${esc(p.url)}" placeholder="http://localhost:11434/v1/chat/completions">
        </div>
      </div>
      <div class="prov-form-row">
        <div class="pf-group">
          <label class="pf-label">Model</label>
          <input class="pf-input" id="pf-model" value="${esc(p.model)}" placeholder="llama3.1:latest">
        </div>
        <div class="pf-group">
          <label class="pf-label">Wait Time (ms)</label>
          <input class="pf-input" id="pf-waitTime" type="number" min="0" value="${p.waitTime ?? 0}">
        </div>
      </div>
      <div class="prov-form-row three">
        <div class="pf-group">
          <label class="pf-label">Temperature</label>
          <input class="pf-input" id="pf-temperature" type="number" step="0.05" min="0" max="2" value="${p.temperature ?? 0.2}">
        </div>
        <div class="pf-group">
          <label class="pf-label">Top-P</label>
          <input class="pf-input" id="pf-top_p" type="number" step="0.05" min="0" max="1" value="${p.top_p ?? 0.9}">
        </div>
        <div class="pf-group">
          <label class="pf-label">Seed</label>
          <input class="pf-input" id="pf-seed" type="number" value="${p.seed ?? 42}">
        </div>
      </div>
      <div class="prov-form-row">
        <div class="pf-group">
          <label class="pf-label">Max tokens</label>
          <input class="pf-input" id="pf-maxTokens" type="number" min="1" value="${p.maxTokens ?? 256}">
        </div>
        <div class="pf-group" style="justify-content:flex-end">
          <span id="pf-test-result" class="pf-test-result" style="display:none"></span>
        </div>
      </div>
    </div>`;

  $('llm-modal-footer').innerHTML = `
    <button class="btn btn-g btn-sm" id="btn-pf-test">${t('llm.test_connection')}</button>
    <button class="btn btn-g btn-sm" id="btn-pf-cancel">${t('misc.cancel')}</button>
    <button class="btn btn-p btn-sm" id="btn-pf-save">${t('misc.save')}</button>`;

  $('btn-pf-cancel').onclick = async () => {
    const fresh = await _loadProviders();
    _renderList(fresh);
  };

  $('btn-pf-test').onclick = async () => {
    const url = $('pf-url').value.trim();
    const el  = $('pf-test-result');
    el.style.display = 'inline';
    el.className     = 'pf-test-result';
    el.textContent   = t('llm.probando');
    const ok = await _testConnection(url);
    el.className   = `pf-test-result ${ok ? 'pf-test-ok' : 'pf-test-err'}`;
    el.textContent = ok ? `● ${t('ai.connected')}` : `● ${t('ai.no_response')}`;
  };

  $('btn-pf-save').onclick = async () => {
    const updated = {
      ...p,
      label:       $('pf-label').value.trim(),
      url:         $('pf-url').value.trim(),
      model:       $('pf-model').value.trim(),
      apiKey:      $('pf-apiKey').value.trim(),
      temperature: parseFloat($('pf-temperature').value) || 0.2,
      top_p:       parseFloat($('pf-top_p').value) || 0.9,
      seed:        parseInt($('pf-seed').value) || 42,
      maxTokens:   parseInt($('pf-maxTokens').value) || 256,
      waitTime:    parseInt($('pf-waitTime').value) || 0,
    };

    if (!updated.label) { toast(t('llm.label_required'), 'warn'); return; }
    if (!updated.url)   { toast(t('llm.url_required'), 'warn');   return; }
    if (!/^https?:\/\//i.test(updated.url)) { toast(t('llm.url_format'), 'warn'); return; }
    if (!updated.model) { toast(t('llm.model_required'), 'warn'); return; }

    const newList = isNew
      ? [...providers, updated]
      : providers.map(x => x.id === updated.id ? updated : x);

    const ok = await _saveProviders(newList);
    if (!ok) { toast(t('llm.save_error'), 'error'); return; }
    toast(isNew ? t('llm.provider_added') : t('llm.provider_updated'));
    _renderList(newList);
  };
}
