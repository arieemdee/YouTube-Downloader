const checkFormatBtn = document.getElementById("checkFormatBtn");
const downloadBtn = document.getElementById("downloadBtn");
const urlInput = document.getElementById('url');
const formatInput = document.getElementById('format');
const formatsPre = document.getElementById('formats');
const resultPre = document.getElementById('result');
const cancelBtn = document.getElementById('cancelBtn');
const retryBtn = document.getElementById('retryBtn');
const progressWrap = document.getElementById('progressWrap');
const progressBar = document.getElementById('progressBar');
const progressText = document.getElementById('progressText');

if (urlInput) {
  urlInput.addEventListener('focus', e => e.target.select());
  urlInput.addEventListener('mouseup', e => e.preventDefault());
}

function handleEnterKey(e) {
  const isEnter = e.key === 'Enter' || e.code === 'Enter';
  if (!isEnter) return;
  e.preventDefault();

  if (document.activeElement === urlInput) {
    getFormats();
  } else if (document.activeElement === formatInput) {
    downloadVideo();
  }
}

if (urlInput) {
  urlInput.addEventListener('keydown', handleEnterKey);
}

if (formatInput) {
  formatInput.addEventListener('keydown', handleEnterKey);
}

async function getFormats() {
  if (!checkFormatBtn || !formatsPre || !urlInput) return;

  checkFormatBtn.disabled = true;
  checkFormatBtn.textContent = 'Memeriksa...';

  try {
    const url = urlInput.value;
    const res = await fetch('/api/formats', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url })
    });

    const text = await res.text();
    const htmlContent = makeFormatIdsClickable(text);
    formatsPre.innerHTML = htmlContent;
  } catch (err) {
    formatsPre.textContent = 'Terjadi kesalahan saat memeriksa format.';
  } finally {
    checkFormatBtn.disabled = false;
    checkFormatBtn.textContent = 'Cek Format';
  }
}

function makeFormatIdsClickable(text) {
  return text.replace(/\b([a-zA-Z0-9_-]+(?:\+[a-zA-Z0-9_-]+)*)\b/g, (match) => {
    return `<span class="format-id" onclick="selectFormat('${match}')" title="Klik untuk memilih">${match}</span>`;
  });
}

function selectFormat(formatId) {
  if (!formatInput) return;

  const currentValue = formatInput.value.trim();
  if (currentValue && !currentValue.endsWith('+')) {
    formatInput.value = currentValue + '+' + formatId;
  } else {
    formatInput.value = formatId;
  }

  formatInput.focus();
}

async function downloadVideo() {
  const url = urlInput ? urlInput.value.trim() : '';
  const format = formatInput ? formatInput.value.trim() : '';

  if (!resultPre) return;
  if (!url) {
    resultPre.textContent = '❌ URL tidak boleh kosong!';
    return;
  }

  if (!format) {
    resultPre.textContent = '❌ Format tidak boleh kosong!';
    return;
  }

  if (downloadBtn) {
    downloadBtn.disabled = true;
    downloadBtn.textContent = 'Downloading...';
  }

  resultPre.textContent = '';

  const params = new URLSearchParams({ url, format });
  const es = new EventSource(`/api/download-stream?${params.toString()}`);
  let currentDownloadId = null;

  if (cancelBtn) {
    cancelBtn.style.display = 'inline-block';
    cancelBtn.disabled = false;
  }
  if (retryBtn) retryBtn.style.display = 'none';
  if (progressWrap) progressWrap.style.display = 'block';
  if (progressBar) progressBar.style.width = '0%';
  if (progressText) progressText.textContent = '0%';

  es.onmessage = (e) => {
    resultPre.textContent += e.data + '\n';
    resultPre.scrollTop = resultPre.scrollHeight;
  };

  es.addEventListener('progress', (e) => {
    const pct = parseFloat(e.data);
    if (!Number.isNaN(pct)) {
      const pctSafe = Math.max(0, Math.min(100, pct));
      if (progressBar) progressBar.style.width = pctSafe + '%';
      if (progressText) progressText.textContent = pctSafe.toFixed(1) + '%';
    }
  });

  es.addEventListener('id', (e) => {
    currentDownloadId = e.data;
  });

  es.addEventListener('done', (e) => {
    resultPre.textContent += '\n✅ Selesai.\n';
    es.close();
    if (downloadBtn) {
      downloadBtn.disabled = false;
      downloadBtn.textContent = 'Download';
    }
    if (formatInput) formatInput.value = '';
    if (cancelBtn) cancelBtn.style.display = 'none';
    refreshDownloadStatus();
    setTimeout(() => { if (progressWrap) progressWrap.style.display = 'none'; }, 800);
  });

  es.addEventListener('error', (e) => {
    resultPre.textContent += '\n❌ Terjadi kesalahan saat mengunduh.\n';
    es.close();
    if (downloadBtn) {
      downloadBtn.disabled = false;
      downloadBtn.textContent = 'Download';
    }
    if (cancelBtn) cancelBtn.style.display = 'none';
    if (retryBtn) retryBtn.style.display = 'inline-block';
    refreshDownloadStatus();
    setTimeout(() => { if (progressWrap) progressWrap.style.display = 'none'; }, 1500);
  });

  window.cancelDownload = async function () {
    if (!currentDownloadId) return;
    try {
      if (cancelBtn) cancelBtn.disabled = true;
      const res = await fetch('/api/download-cancel', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: currentDownloadId })
      });
      const json = await res.json();
      resultPre.textContent += json && json.ok
        ? '\n⚠️ Download dibatalkan oleh pengguna.\n'
        : '\n⚠️ Gagal membatalkan download.\n';
    } catch (err) {
      resultPre.textContent += '\n⚠️ Error saat membatalkan.\n';
    } finally {
      try { es.close(); } catch (e) {}
      if (downloadBtn) {
        downloadBtn.disabled = false;
        downloadBtn.textContent = 'Download';
      }
      if (cancelBtn) cancelBtn.style.display = 'none';
      if (retryBtn) retryBtn.style.display = 'inline-block';
      if (progressWrap) progressWrap.style.display = 'none';
    }
  };

  window.retryDownload = function () {
    if (retryBtn) retryBtn.style.display = 'none';
    downloadVideo();
  };

  es.onerror = () => {
    if (es.readyState === EventSource.CLOSED) return;
    resultPre.textContent += '\n❌ Koneksi terputus.\n';
    es.close();
    if (downloadBtn) {
      downloadBtn.disabled = false;
      downloadBtn.textContent = 'Download';
    }
  };
}

async function refreshDownloadStatus() {
  const moveFilesBtn = document.getElementById('moveFilesBtn');
  const moveDestinationInput = document.getElementById('moveDestinationInput');

  try {
    const res = await fetch('/api/download-status');
    const data = await res.json();
    const count = Number(data.count || 0);

    if (moveFilesBtn) {
      moveFilesBtn.disabled = count <= 0;
      moveFilesBtn.textContent = `Pindah hasil download (${count})`;
    }

    if (data.destination && moveDestinationInput && !moveDestinationInput.value.trim()) {
      moveDestinationInput.value = data.destination;
    }
  } catch (err) {
    if (moveFilesBtn) {
      moveFilesBtn.disabled = true;
      moveFilesBtn.textContent = 'Pindah hasil download (error)';
    }
  }
}

async function browseMoveFolder() {
  try {
    const res = await fetch('/api/select-folder');
    const data = await res.json();
    const moveDestinationInput = document.getElementById('moveDestinationInput');

    if (data && data.ok && data.path && moveDestinationInput) {
      moveDestinationInput.value = data.path;
      resultPre.textContent = `📁 Folder dipilih: ${data.path}`;
    } else {
      resultPre.textContent = '❌ Tidak ada folder yang dipilih.';
    }
  } catch (err) {
    resultPre.textContent = '❌ Gagal membuka pemilih folder.';
  }
}

async function saveMoveFolder() {
  const moveDestinationInput = document.getElementById('moveDestinationInput');
  const destination = moveDestinationInput ? moveDestinationInput.value.trim() : '';

  if (!destination) {
    resultPre.textContent = '❌ Path folder tujuan belum diisi.';
    return;
  }

  try {
    const res = await fetch('/api/save-output-move', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ destination })
    });
    const data = await res.json();

    if (data && data.ok) {
      resultPre.textContent = `✅ Folder tujuan tersimpan ke config.json:\n${data.destination}`;
      await refreshDownloadStatus();
    } else {
      resultPre.textContent = `❌ Gagal menyimpan: ${data.error || 'Unknown error'}`;
    }
  } catch (err) {
    resultPre.textContent = `❌ Gagal menyimpan: ${err.message || err}`;
  }
}

async function moveDownloadedFiles() {
  const moveFilesBtn = document.getElementById('moveFilesBtn');
  const moveDestinationInput = document.getElementById('moveDestinationInput');
  const destination = moveDestinationInput ? moveDestinationInput.value.trim() : '';

  if (moveFilesBtn) {
    moveFilesBtn.disabled = true;
    moveFilesBtn.textContent = 'Memindahkan...';
  }

  resultPre.textContent = '';
  if (progressWrap) progressWrap.style.display = 'block';
  if (progressBar) progressBar.style.width = '0%';
  if (progressText) progressText.textContent = '0%';

  const es = new EventSource(`/api/move-downloads-stream?destination=${encodeURIComponent(destination || '')}`);

  es.addEventListener('progress', (e) => {
    try {
      const data = JSON.parse(e.data);
      const pct = Number.isFinite(data.percent) ? Math.max(0, Math.min(100, data.percent)) : 0;
      if (progressBar) progressBar.style.width = pct + '%';
      if (progressText) progressText.textContent = `${pct}% (${data.completed || 0}/${data.total || 0})`;
      resultPre.textContent = `📦 Memindahkan ${data.filename || 'file'} (${data.completed || 0}/${data.total || 0})...`;
      resultPre.scrollTop = resultPre.scrollHeight;
    } catch (err) {
      // ignore parse errors
    }
  });

  es.addEventListener('done', (e) => {
    try {
      const data = JSON.parse(e.data);
      resultPre.textContent = data.status === 'success'
        ? `✅ Dipindah ${data.moved} file ke:\n${data.destination}`
        : `❌ Gagal memindahkan: ${data.error || 'Unknown error'}`;
      if (progressBar) progressBar.style.width = '100%';
      if (progressText) progressText.textContent = '100%';
    } catch (err) {
      resultPre.textContent = '❌ Gagal memindahkan file.';
    }
    es.close();
    refreshDownloadStatus().finally(() => {
      setTimeout(() => { if (progressWrap) progressWrap.style.display = 'none'; }, 800);
    });
  });

  es.addEventListener('error', (e) => {
    try {
      const data = JSON.parse(e.data);
      resultPre.textContent = `❌ Gagal memindahkan: ${data.error || 'Unknown error'}`;
    } catch (err) {
      resultPre.textContent = '❌ Gagal memindahkan file.';
    }
    es.close();
    refreshDownloadStatus().finally(() => {
      setTimeout(() => { if (progressWrap) progressWrap.style.display = 'none'; }, 1200);
    });
  });

  es.onerror = () => {
    if (es.readyState === EventSource.CLOSED) return;
    es.close();
  };
}

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
    const res = await fetch('/api/check-update');
    const data = await res.json();

    if (data.error) {
      statusDiv.className = 'update-status error';
      statusDiv.textContent = '❌ Error: ' + data.error;
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
  } catch (err) {
    statusDiv.className = 'update-status error';
    statusDiv.textContent = '❌ Error: ' + err.message;
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
    const res = await fetch('/api/update', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' }
    });
    const data = await res.json();

    if (data.status === 'success' || data.status === 'already_latest') {
      statusDiv.className = 'update-status latest';
      statusDiv.textContent = `✅ ${data.message}`;
      updateBtn.style.display = 'none';
    } else {
      statusDiv.className = 'update-status error';
      statusDiv.textContent = `❌ Update gagal: ${data.message}`;
    }
  } catch (err) {
    statusDiv.className = 'update-status error';
    statusDiv.textContent = '❌ Error: ' + err.message;
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
    const res = await fetch('/api/clear-update-cache', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' }
    });
    const data = await res.json();

    if (data.success) {
      cacheInfoDiv.textContent = '✅ Cache dihapus! Next check akan hit API baru.';
      setTimeout(() => checkUpdate(), 1000);
    } else {
      cacheInfoDiv.textContent = '⚠️ Cache sudah kosong';
    }
  } catch (err) {
    cacheInfoDiv.textContent = '❌ Error: ' + err.message;
  } finally {
    clearCacheBtn.disabled = false;
  }
}

window.addEventListener('load', () => {
  checkUpdate();
  refreshDownloadStatus();
});
