// File ini berisi logika utama UI untuk aplikasi downloader.
// Struktur dibagi menurut area fungsi agar lebih mudah dibaca dan dirawat.

const DOM = {
  checkFormatBtn: document.getElementById('checkFormatBtn'),
  downloadBtn: document.getElementById('downloadBtn'),
  urlInput: document.getElementById('url'),
  formatInput: document.getElementById('format'),
  formatsPre: document.getElementById('formats'),
  resultPre: document.getElementById('result'),
  cancelBtn: document.getElementById('cancelBtn'),
  retryBtn: document.getElementById('retryBtn'),
  progressWrap: document.getElementById('progressWrap'),
  progressBar: document.getElementById('progressBar'),
  progressText: document.getElementById('progressText'),
};

function initInputBehavior() {
  // Memastikan input URL langsung terseleksi saat fokus agar lebih nyaman untuk edit ulang.
  if (DOM.urlInput) {
    DOM.urlInput.addEventListener('focus', (event) => event.target.select());
    DOM.urlInput.addEventListener('mouseup', (event) => event.preventDefault());
  }

  // Tekan Enter di URL = cek format, di format = mulai download.
  const handleEnterKey = (event) => {
    const isEnter = event.key === 'Enter' || event.code === 'Enter';
    if (!isEnter) return;

    event.preventDefault();

    if (document.activeElement === DOM.urlInput) {
      getFormats();
    } else if (document.activeElement === DOM.formatInput) {
      downloadVideo();
    }
  };

  if (DOM.urlInput) DOM.urlInput.addEventListener('keydown', handleEnterKey);
  if (DOM.formatInput) DOM.formatInput.addEventListener('keydown', handleEnterKey);
}

function setBusy(button, label, isBusy) {
  if (!button) return;
  button.disabled = isBusy;
  button.textContent = isBusy ? label : button.dataset.defaultLabel || label;
}

function showResult(message) {
  if (DOM.resultPre) DOM.resultPre.textContent = message;
}

function resetProgress() {
  if (DOM.progressWrap) DOM.progressWrap.style.display = 'block';
  if (DOM.progressBar) DOM.progressBar.style.width = '0%';
  if (DOM.progressText) DOM.progressText.textContent = '0%';
}

function hideProgress(delay = 800) {
  setTimeout(() => {
    if (DOM.progressWrap) DOM.progressWrap.style.display = 'none';
  }, delay);
}

async function refreshHistory() {
  const historyList = document.getElementById('historyList');
  if (!historyList) return;

  try {
    const response = await fetch('/api/history');
    const data = await response.json();

    if (!Array.isArray(data) || !data.length) {
      historyList.innerHTML = '<div class="history-empty">Belum ada riwayat download.</div>';
      return;
    }

    historyList.innerHTML = data.map((item) => {
      const createdAt = item.createdAt ? new Date(item.createdAt).toLocaleString('id-ID') : '—';
      const statusLabel = item.status === 'success' ? 'Sukses' : 'Gagal';
      const urlLabel = item.url ? item.url : 'URL tidak tersedia';
      return `
        <article class="history-card">
          <strong>${escapeHtml(urlLabel)}</strong>
          <div class="history-meta">
            <span>Format: ${escapeHtml(item.format || '-')}</span>
            <span>Waktu: ${escapeHtml(createdAt)}</span>
            <span class="history-badge">${statusLabel}</span>
          </div>
        </article>`;
    }).join('');
  } catch (error) {
    historyList.innerHTML = '<div class="history-empty">Gagal memuat riwayat.</div>';
  }
}

function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function makeFormatIdsClickable(text) {
  // Mengubah ID format menjadi elemen klik agar user bisa langsung pilih format.
  return text.replace(/\b([a-zA-Z0-9_-]+(?:\+[a-zA-Z0-9_-]+)*)\b/g, (match) => {
    return `<span class="format-id" onclick="selectFormat('${match}')" title="Klik untuk memilih">${match}</span>`;
  });
}

function selectFormat(formatId) {
  if (!DOM.formatInput) return;

  const currentValue = DOM.formatInput.value.trim();
  DOM.formatInput.value = currentValue && !currentValue.endsWith('+')
    ? `${currentValue}+${formatId}`
    : formatId;

  DOM.formatInput.focus();
}

// =========================
// BAGIAN FORMAT / DOWNLOAD
// =========================

async function getFormats() {
  if (!DOM.checkFormatBtn || !DOM.formatsPre || !DOM.urlInput) return;

  DOM.checkFormatBtn.disabled = true;
  DOM.checkFormatBtn.textContent = 'Memeriksa...';

  try {
    const response = await fetch('/api/formats', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: DOM.urlInput.value })
    });

    const text = await response.text();
    DOM.formatsPre.innerHTML = makeFormatIdsClickable(text);
  } catch (error) {
    DOM.formatsPre.textContent = 'Terjadi kesalahan saat memeriksa format.';
  } finally {
    DOM.checkFormatBtn.disabled = false;
    DOM.checkFormatBtn.textContent = 'Cek Format';
  }
}

async function downloadVideo() {
  const url = DOM.urlInput?.value.trim() || '';
  const format = DOM.formatInput?.value.trim() || '';

  if (!DOM.resultPre) return;
  if (!url) {
    showResult('❌ URL tidak boleh kosong!');
    return;
  }

  if (!format) {
    showResult('❌ Format tidak boleh kosong!');
    return;
  }

  // Mulai proses download dengan state UI yang jelas.
  DOM.downloadBtn.disabled = true;
  DOM.downloadBtn.textContent = 'Downloading...';
  DOM.resultPre.textContent = '';

  const params = new URLSearchParams({ url, format });
  const eventSource = new EventSource(`/api/download-stream?${params.toString()}`);
  let currentDownloadId = null;

  if (DOM.cancelBtn) {
    DOM.cancelBtn.style.display = 'inline-block';
    DOM.cancelBtn.disabled = false;
  }
  if (DOM.retryBtn) DOM.retryBtn.style.display = 'none';

  resetProgress();

  eventSource.onmessage = (event) => {
    DOM.resultPre.textContent += `${event.data}\n`;
    DOM.resultPre.scrollTop = DOM.resultPre.scrollHeight;
  };

  eventSource.addEventListener('progress', (event) => {
    const percent = parseFloat(event.data);
    if (!Number.isNaN(percent)) {
      const safePercent = Math.max(0, Math.min(100, percent));
      if (DOM.progressBar) DOM.progressBar.style.width = `${safePercent}%`;
      if (DOM.progressText) DOM.progressText.textContent = `${safePercent.toFixed(1)}%`;
    }
  });

  eventSource.addEventListener('id', (event) => {
    currentDownloadId = event.data;
  });

  eventSource.addEventListener('done', () => {
    DOM.resultPre.textContent += '\n✅ Selesai.\n';
    eventSource.close();

    if (DOM.downloadBtn) {
      DOM.downloadBtn.disabled = false;
      DOM.downloadBtn.textContent = 'Download';
    }
    if (DOM.formatInput) DOM.formatInput.value = '';
    if (DOM.cancelBtn) DOM.cancelBtn.style.display = 'none';

    refreshDownloadStatus();
    refreshHistory();
    hideProgress(800);
  });

  eventSource.addEventListener('error', () => {
    DOM.resultPre.textContent += '\n❌ Terjadi kesalahan saat mengunduh.\n';
    eventSource.close();

    if (DOM.downloadBtn) {
      DOM.downloadBtn.disabled = false;
      DOM.downloadBtn.textContent = 'Download';
    }
    if (DOM.cancelBtn) DOM.cancelBtn.style.display = 'none';
    if (DOM.retryBtn) DOM.retryBtn.style.display = 'inline-block';

    refreshDownloadStatus();
    hideProgress(1500);
  });

  window.cancelDownload = async () => {
    if (!currentDownloadId) return;

    try {
      if (DOM.cancelBtn) DOM.cancelBtn.disabled = true;
      const response = await fetch('/api/download-cancel', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: currentDownloadId })
      });

      const json = await response.json();
      DOM.resultPre.textContent += json && json.ok
        ? '\n⚠️ Download dibatalkan oleh pengguna.\n'
        : '\n⚠️ Gagal membatalkan download.\n';
    } catch (error) {
      DOM.resultPre.textContent += '\n⚠️ Error saat membatalkan.\n';
    } finally {
      try { eventSource.close(); } catch (error) {}
      if (DOM.downloadBtn) {
        DOM.downloadBtn.disabled = false;
        DOM.downloadBtn.textContent = 'Download';
      }
      if (DOM.cancelBtn) DOM.cancelBtn.style.display = 'none';
      if (DOM.retryBtn) DOM.retryBtn.style.display = 'inline-block';
      if (DOM.progressWrap) DOM.progressWrap.style.display = 'none';
    }
  };

  window.retryDownload = () => {
    if (DOM.retryBtn) DOM.retryBtn.style.display = 'none';
    downloadVideo();
  };

  eventSource.onerror = () => {
    if (eventSource.readyState === EventSource.CLOSED) return;
    DOM.resultPre.textContent += '\n❌ Koneksi terputus.\n';
    eventSource.close();
    if (DOM.downloadBtn) {
      DOM.downloadBtn.disabled = false;
      DOM.downloadBtn.textContent = 'Download';
    }
  };
}

// =========================
// BAGIAN MOVE FILE / FOLDER
// =========================

async function refreshDownloadStatus() {
  const moveFilesBtn = document.getElementById('moveFilesBtn');
  const moveDestinationInput = document.getElementById('moveDestinationInput');

  try {
    const response = await fetch('/api/download-status');
    const data = await response.json();
    const count = Number(data.count || 0);

    if (moveFilesBtn) {
      moveFilesBtn.disabled = count <= 0;
      moveFilesBtn.textContent = `Pindah hasil download (${count})`;
    }

    if (data.destination && moveDestinationInput && !moveDestinationInput.value.trim()) {
      moveDestinationInput.value = data.destination;
    }
  } catch (error) {
    if (moveFilesBtn) {
      moveFilesBtn.disabled = true;
      moveFilesBtn.textContent = 'Pindah hasil download (error)';
    }
  }
}

async function browseMoveFolder() {
  try {
    const response = await fetch('/api/select-folder');
    const data = await response.json();
    const moveDestinationInput = document.getElementById('moveDestinationInput');

    if (data && data.ok && data.path && moveDestinationInput) {
      moveDestinationInput.value = data.path;
      showResult(`📁 Folder dipilih: ${data.path}`);
    } else {
      showResult('❌ Tidak ada folder yang dipilih.');
    }
  } catch (error) {
    showResult('❌ Gagal membuka pemilih folder.');
  }
}

async function saveMoveFolder() {
  const moveDestinationInput = document.getElementById('moveDestinationInput');
  const destination = moveDestinationInput?.value.trim() || '';

  if (!destination) {
    showResult('❌ Path folder tujuan belum diisi.');
    return;
  }

  try {
    const response = await fetch('/api/save-output-move', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ destination })
    });
    const data = await response.json();

    if (data && data.ok) {
      showResult(`✅ Folder tujuan tersimpan ke config.json:\n${data.destination}`);
      await refreshDownloadStatus();
    } else {
      showResult(`❌ Gagal menyimpan: ${data.error || 'Unknown error'}`);
    }
  } catch (error) {
    showResult(`❌ Gagal menyimpan: ${error.message || error}`);
  }
}

async function moveDownloadedFiles() {
  const moveFilesBtn = document.getElementById('moveFilesBtn');
  const moveDestinationInput = document.getElementById('moveDestinationInput');
  const destination = moveDestinationInput?.value.trim() || '';

  if (moveFilesBtn) {
    moveFilesBtn.disabled = true;
    moveFilesBtn.textContent = 'Memindahkan...';
  }

  showResult('');
  resetProgress();

  const eventSource = new EventSource(`/api/move-downloads-stream?destination=${encodeURIComponent(destination || '')}`);

  eventSource.addEventListener('progress', (event) => {
    try {
      const data = JSON.parse(event.data);
      const percent = Number.isFinite(data.percent) ? Math.max(0, Math.min(100, data.percent)) : 0;

      if (DOM.progressBar) DOM.progressBar.style.width = `${percent}%`;
      if (DOM.progressText) DOM.progressText.textContent = `${percent}% (${data.completed || 0}/${data.total || 0})`;

      DOM.resultPre.textContent = `📦 Memindahkan ${data.filename || 'file'} (${data.completed || 0}/${data.total || 0})...`;
      DOM.resultPre.scrollTop = DOM.resultPre.scrollHeight;
    } catch (error) {
      // ignore parse errors
    }
  });

  eventSource.addEventListener('done', (event) => {
    try {
      const data = JSON.parse(event.data);
      DOM.resultPre.textContent = data.status === 'success'
        ? `✅ Dipindah ${data.moved} file ke:\n${data.destination}`
        : `❌ Gagal memindahkan: ${data.error || 'Unknown error'}`;

      if (DOM.progressBar) DOM.progressBar.style.width = '100%';
      if (DOM.progressText) DOM.progressText.textContent = '100%';
    } catch (error) {
      DOM.resultPre.textContent = '❌ Gagal memindahkan file.';
    }

    eventSource.close();
    refreshDownloadStatus().finally(() => hideProgress(800));
  });

  eventSource.addEventListener('error', (event) => {
    try {
      const data = JSON.parse(event.data);
      DOM.resultPre.textContent = `❌ Gagal memindahkan: ${data.error || 'Unknown error'}`;
    } catch (error) {
      DOM.resultPre.textContent = '❌ Gagal memindahkan file.';
    }

    eventSource.close();
    refreshDownloadStatus().finally(() => hideProgress(1200));
  });

  eventSource.onerror = () => {
    if (eventSource.readyState === EventSource.CLOSED) return;
    eventSource.close();
  };
}

// =========================
// BAGIAN UPDATE / STATUS
// =========================

async function checkUpdate() {
  const checkBtn = document.getElementById('checkUpdateBtn');
  const updateBtn = document.getElementById('updateBtn');
  const statusDiv = document.getElementById('updateStatus');
  const cacheInfoDiv = document.getElementById('cacheInfo');
  const clearCacheBtn = document.getElementById('clearCacheBtn');

  if (!checkBtn || !statusDiv || !cacheInfoDiv || !clearCacheBtn) return;

  checkBtn.disabled = true;
  updateBtn.style.display = 'none';
  cacheInfoDiv.textContent = '';
  clearCacheBtn.style.display = 'none';
  statusDiv.className = 'update-status checking';
  statusDiv.textContent = '🔄 Memeriksa update...';

  try {
    const response = await fetch('/api/check-update');
    const data = await response.json();

    if (data.error) {
      statusDiv.className = 'update-status error';
      statusDiv.textContent = `❌ Error: ${data.error}`;
      return;
    }

    if (data.cached) {
      cacheInfoDiv.textContent = '💾 Menggunakan cache (diperbarui dalam 24 jam terakhir) | ';
      if (data.stale) cacheInfoDiv.textContent += '⚠️ Cache lama digunakan karena pengecekan GitHub gagal.';
      clearCacheBtn.style.display = 'inline-block';
    } else {
      cacheInfoDiv.textContent = '🔄 Baru di-check dari GitHub API';
      clearCacheBtn.style.display = 'inline-block';
    }

    if (data.updateAvailable) {
      statusDiv.className = 'update-status available';
      statusDiv.textContent = `⚠️ Update tersedia! Versi saat ini: ${data.currentVersion} → ${data.latestVersion}`;
      updateBtn.style.display = 'inline-block';
    } else {
      statusDiv.className = 'update-status latest';
      statusDiv.textContent = `✅ Sudah versi terbaru: ${data.currentVersion}`;
    }
  } catch (error) {
    statusDiv.className = 'update-status error';
    statusDiv.textContent = `❌ Error: ${error.message}`;
  } finally {
    checkBtn.disabled = false;
  }
}

async function performUpdate() {
  const updateBtn = document.getElementById('updateBtn');
  const statusDiv = document.getElementById('updateStatus');

  if (!updateBtn || !statusDiv) return;

  const confirmed = confirm('⚠️ PERHATIAN!\n\nUpdate akan mengunduh versi terbaru yt-dlp dan mengganti file yang ada.\n\nProses ini mungkin memakan waktu beberapa menit.\n\nLanjutkan?');

  if (!confirmed) {
    statusDiv.className = 'update-status';
    statusDiv.textContent = '';
    return;
  }

  updateBtn.disabled = true;
  statusDiv.className = 'update-status updating';
  statusDiv.textContent = '📥 Sedang update... Mohon tunggu, jangan tutup aplikasi!';

  try {
    const response = await fetch('/api/update', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' }
    });
    const data = await response.json();

    if (data.status === 'success' || data.status === 'already_latest') {
      statusDiv.className = 'update-status latest';
      statusDiv.textContent = `✅ ${data.message}`;
      updateBtn.style.display = 'none';
    } else {
      statusDiv.className = 'update-status error';
      statusDiv.textContent = `❌ Update gagal: ${data.message}`;
    }
  } catch (error) {
    statusDiv.className = 'update-status error';
    statusDiv.textContent = `❌ Error: ${error.message}`;
  } finally {
    updateBtn.disabled = false;
  }
}

async function clearUpdateCache() {
  const clearCacheBtn = document.getElementById('clearCacheBtn');
  const cacheInfoDiv = document.getElementById('cacheInfo');

  if (!clearCacheBtn || !cacheInfoDiv) return;

  clearCacheBtn.disabled = true;
  cacheInfoDiv.textContent = '🗑️ Sedang menghapus cache...';

  try {
    const response = await fetch('/api/clear-update-cache', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' }
    });
    const data = await response.json();

    if (data.success) {
      cacheInfoDiv.textContent = '✅ Cache dihapus! Next check akan hit API baru.';
      setTimeout(() => checkUpdate(), 1000);
    } else {
      cacheInfoDiv.textContent = '⚠️ Cache sudah kosong';
    }
  } catch (error) {
    cacheInfoDiv.textContent = `❌ Error: ${error.message}`;
  } finally {
    clearCacheBtn.disabled = false;
  }
}

window.addEventListener('load', () => {
  initInputBehavior();
  checkUpdate();
  refreshDownloadStatus();
  refreshHistory();
});
