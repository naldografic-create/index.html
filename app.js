const canvas = document.getElementById('mockupCanvas');
const ctx = canvas.getContext('2d');

// Estado global de la aplicación
const state = {
  garmentType: 'tshirt',
  garmentColor: '#ffffff',
  rawImage: null,
  svgDoc: null,          // Documento DOM del SVG vectorizado
  vectorLayers: [],      // Capas agrupadas por color
  vectorImageObj: null,  // Imagen renderizada del SVG actual
  designX: 540,
  designY: 560,
  designScale: 1,
  designRotate: 0,
  blendMode: 'normal',
  isDragging: false,
  dragOffsetX: 0,
  dragOffsetY: 0
};

// Elementos del DOM
const imageInput = document.getElementById('imageInput');
const dropZone = document.getElementById('dropZone');
const numberOfColors = document.getElementById('numberOfColors');
const colorCountLabel = document.getElementById('colorCountLabel');
const removeBgCheck = document.getElementById('removeBgCheck');
const btnRevectorize = document.getElementById('btnRevectorize');
const layersContainer = document.getElementById('layersContainer');

// Inicializar lienzo
renderCanvas();

// --- EVENTOS DE PRENDA ---
document.getElementById('garmentType').addEventListener('change', (e) => {
  state.garmentType = e.target.value;
  state.designY = state.garmentType === 'mug' ? 680 : 560;
  renderCanvas();
});

document.querySelectorAll('.swatch').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.swatch').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    state.garmentColor = btn.dataset.color;
    document.getElementById('garmentCustomColor').value = state.garmentColor;
    renderCanvas();
  });
});

document.getElementById('garmentCustomColor').addEventListener('input', (e) => {
  state.garmentColor = e.target.value;
  renderCanvas();
});

// --- SUBIDA DE IMAGEN ---
dropZone.addEventListener('click', () => imageInput.click());
dropZone.addEventListener('dragover', (e) => { e.preventDefault(); dropZone.style.borderColor = '#ff6b00'; });
dropZone.addEventListener('dragleave', () => { dropZone.style.borderColor = '#262b38'; });
dropZone.addEventListener('drop', (e) => {
  e.preventDefault();
  dropZone.style.borderColor = '#262b38';
  if (e.dataTransfer.files.length) handleFile(e.dataTransfer.files[0]);
});

imageInput.addEventListener('change', (e) => {
  if (e.target.files.length) handleFile(e.target.files[0]);
});

numberOfColors.addEventListener('input', (e) => {
  colorCountLabel.textContent = e.target.value;
});

btnRevectorize.addEventListener('click', () => {
  if (state.rawImage) vectorizeImage(state.rawImage);
});

function handleFile(file) {
  const reader = new FileReader();
  reader.onload = (event) => {
    const img = new Image();
    img.onload = () => {
      state.rawImage = img;
      btnRevectorize.disabled = false;
      vectorizeImage(img);
    };
    img.src = event.target.result;
  };
  reader.readAsDataURL(file);
}

// --- MOTOR DE VECTORIZACIÓN Y EXTRACCIÓN DE CAPAS ---
function vectorizeImage(img) {
  // Escalar imagen internamente a máx 800px para vectorizar rápido y limpio
  const tempCanvas = document.createElement('canvas');
  const maxDim = 800;
  let w = img.width;
  let h = img.height;
  if (w > maxDim || h > maxDim) {
    const ratio = Math.min(maxDim / w, maxDim / h);
    w = Math.round(w * ratio);
    h = Math.round(h * ratio);
  }
  tempCanvas.width = w;
  tempCanvas.height = h;
  const tCtx = tempCanvas.getContext('2d');
  tCtx.drawImage(img, 0, 0, w, h);

  const imgData = tCtx.getImageData(0, 0, w, h);
  const bgColor = detectCornerColor(imgData);

  const options = {
    numberofcolors: parseInt(numberOfColors.value, 10),
    ltres: 1,
    qtres: 1,
    pathomit: 8,
    rightangleenhance: true,
    strokewidth: 0,
    viewbox: true
  };

  // Convertir píxeles a cadena SVG
  const svgString = ImageTracer.imagedataToSVG(imgData, options);
  const parser = new DOMParser();
  const doc = parser.parseFromString(svgString, 'image/svg+xml');
  const svgEl = doc.querySelector('svg');

  // Agrupar trazados (<path>) por color para crear capas editables
  const paths = Array.from(svgEl.querySelectorAll('path'));
  const colorMap = new Map();

  paths.forEach((path) => {
    const fill = path.getAttribute('fill');
    const opacity = path.getAttribute('opacity');
    if (!fill || fill === 'none' || opacity === '0') {
      path.remove();
      return;
    }

    const hex = rgbToHex(fill);
    if (!colorMap.has(hex)) {
      colorMap.set(hex, []);
    }
    colorMap.get(hex).push(path);
  });

  state.svgDoc = svgEl;
  state.vectorLayers = [];

  let layerIndex = 1;
  colorMap.forEach((layerPaths, hex) => {
    // Detectar si esta capa corresponde al fondo
    const isBackground = removeBgCheck.checked && isColorClose(hex, bgColor, 35);
    state.vectorLayers.push({
      id: layerIndex++,
      name: isBackground ? `Fondo (Detectado)` : `Capa Color ${layerIndex - 1}`,
      color: hex,
      visible: !isBackground,
      paths: layerPaths
    });
  });

  renderLayersUI();
  updateVectorPreview();
}

// Construir panel derecho de capas
function renderLayersUI() {
  layersContainer.innerHTML = '';

  state.vectorLayers.forEach((layer) => {
    const item = document.createElement('div');
    item.className = 'layer-item';

    item.innerHTML = `
      <div class="layer-left">
        <input type="color" class="layer-color-picker" value="${layer.color}" title="Cambiar color de capa" />
        <div class="layer-info">
          <span class="layer-title">${layer.name}</span>
          <span class="layer-hex">${layer.color}</span>
        </div>
      </div>
      <input type="checkbox" ${layer.visible ? 'checked' : ''} title="Mostrar/Ocultar capa" />
    `;

    // Evento cambiar color de la capa
    const colorInput = item.querySelector('input[type="color"]');
    const hexLabel = item.querySelector('.layer-hex');
    colorInput.addEventListener('input', (e) => {
      layer.color = e.target.value;
      hexLabel.textContent = layer.color;
      applyLayerChangesToSVG();
    });

    // Evento ocultar/mostrar capa (transparencia)
    const visCheckbox = item.querySelector('input[type="checkbox"]');
    visCheckbox.addEventListener('change', (e) => {
      layer.visible = e.target.checked;
      applyLayerChangesToSVG();
    });

    layersContainer.appendChild(item);
  });

  applyLayerChangesToSVG();
}

function applyLayerChangesToSVG() {
  if (!state.svgDoc) return;

  state.vectorLayers.forEach((layer) => {
    layer.paths.forEach((p) => {
      p.setAttribute('fill', layer.color);
      p.style.display = layer.visible ? 'inline' : 'none';
    });
  });

  updateVectorPreview();
}

function updateVectorPreview() {
  const serializer = new XMLSerializer();
  const svgStr = serializer.serializeToString(state.svgDoc);
  const blob = new Blob([svgStr], { type: 'image/svg+xml;charset=utf-8' });
  const url = URL.createObjectURL(blob);

  const img = new Image();
  img.onload = () => {
    state.vectorImageObj = img;
    document.getElementById('btnDownloadSVG').disabled = false;
    document.getElementById('btnDownloadPNG').disabled = false;
    renderCanvas();
    URL.revokeObjectURL(url);
  };
  img.src = url;
}

// --- CONTROLES DE TRANSFORMACIÓN ---
document.getElementById('designScale').addEventListener('input', (e) => {
  state.designScale = e.target.value / 100;
  document.getElementById('scaleLabel').textContent = `${e.target.value}%`;
  renderCanvas();
});

document.getElementById('designRotate').addEventListener('input', (e) => {
  state.designRotate = parseInt(e.target.value, 10);
  document.getElementById('rotateLabel').textContent = `${e.target.value}°`;
  renderCanvas();
});

document.getElementById('blendMode').addEventListener('change', (e) => {
  state.blendMode = e.target.value;
  renderCanvas();
});

// Arrastre con el mouse sobre el lienzo
canvas.addEventListener('mousedown', (e) => {
  const rect = canvas.getBoundingClientRect();
  const scaleX = canvas.width / rect.width;
  const scaleY = canvas.height / rect.height;
  const mouseX = (e.clientX - rect.left) * scaleX;
  const mouseY = (e.clientY - rect.top) * scaleY;

  state.isDragging = true;
  state.dragOffsetX = mouseX - state.designX;
  state.dragOffsetY = mouseY - state.designY;
});

canvas.addEventListener('mousemove', (e) => {
  if (!state.isDragging) return;
  const rect = canvas.getBoundingClientRect();
  const scaleX = canvas.width / rect.width;
  const scaleY = canvas.height / rect.height;
  state.designX = (e.clientX - rect.left) * scaleX - state.dragOffsetX;
  state.designY = (e.clientY - rect.top) * scaleY - state.dragOffsetY;
  renderCanvas();
});

window.addEventListener('mouseup', () => { state.isDragging = false; });

// --- RENDERIZADO DE PRENDA + VECTOR ---
function renderCanvas() {
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  // Fondo estudio fotográfico
  const grad = ctx.createRadialGradient(540, 650, 100, 540, 675, 850);
  grad.addColorStop(0, '#2a2f3d');
  grad.addColorStop(1, '#14171f');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  drawGarmentBase(ctx, state.garmentType, state.garmentColor);

  // Dibujar vector editado encima
  if (state.vectorImageObj) {
    ctx.save();
    ctx.translate(state.designX, state.designY);
    ctx.rotate((state.designRotate * Math.PI) / 180);
    ctx.scale(state.designScale, state.designScale);
    ctx.globalCompositeOperation = state.blendMode;

    const baseWidth = 360;
    const aspect = state.vectorImageObj.height / state.vectorImageObj.width;
    const drawW = baseWidth;
    const drawH = baseWidth * aspect;

    ctx.drawImage(state.vectorImageObj, -drawW / 2, -drawH / 2, drawW, drawH);
    ctx.restore();
  }
}

function drawGarmentBase(ctx, type, color) {
  ctx.save();
  ctx.fillStyle = color;
  ctx.shadowColor = 'rgba(0,0,0,0.45)';
  ctx.shadowBlur = 35;
  ctx.shadowOffsetY = 20;

  ctx.beginPath();
  if (type === 'tshirt') {
    ctx.moveTo(360, 230);
    ctx.quadraticCurveTo(540, 310, 720, 230); // Cuello
    ctx.lineTo(940, 340); // Hombro der
    ctx.lineTo(860, 520); // Manga der
    ctx.lineTo(770, 480); // Axila der
    ctx.lineTo(770, 1140); // Costado der
    ctx.lineTo(310, 1140); // Ruedo
    ctx.lineTo(310, 480); // Costado izq
    ctx.lineTo(220, 520); // Axila izq
    ctx.lineTo(140, 340); // Manga izq
    ctx.closePath();
    ctx.fill();
  } else if (type === 'hoodie') {
    ctx.moveTo(370, 240);
    ctx.lineTo(930, 350);
    ctx.lineTo(880, 920);
    ctx.lineTo(780, 920);
    ctx.lineTo(780, 1150);
    ctx.lineTo(300, 1150);
    ctx.lineTo(300, 920);
    ctx.lineTo(200, 920);
    ctx.lineTo(150, 350);
    ctx.closePath();
    ctx.fill();
    // Capucha
    ctx.beginPath();
    ctx.arc(540, 220, 175, Math.PI, 0);
    ctx.fill();
  } else if (type === 'mug') {
    // Asa
    ctx.lineWidth = 42;
    ctx.strokeStyle = color;
    ctx.beginPath();
    ctx.arc(760, 680, 130, -Math.PI / 2, Math.PI / 2);
    ctx.stroke();
    // Cuerpo taza
    ctx.fillRect(310, 430, 450, 500);
  }
  ctx.restore();

  // Sombreado realista de pliegues
  const foldGrad = ctx.createLinearGradient(300, 300, 800, 1100);
  foldGrad.addColorStop(0, 'rgba(255,255,255,0.08)');
  foldGrad.addColorStop(0.5, 'rgba(0,0,0,0.04)');
  foldGrad.addColorStop(1, 'rgba(0,0,0,0.22)');
  ctx.fillStyle = foldGrad;
  ctx.fill();
}

// --- EXPORTACIONES ---
// 1. Descargar Vector SVG limpio y editable
document.getElementById('btnDownloadSVG').addEventListener('click', () => {
  if (!state.svgDoc) return;
  const clone = state.svgDoc.cloneNode(true);
  // Eliminar capas ocultas del archivo final
  clone.querySelectorAll('path').forEach(p => {
    if (p.style.display === 'none') p.remove();
  });
  const serializer = new XMLSerializer();
  const svgBlob = new Blob([serializer.serializeToString(clone)], { type: 'image/svg+xml' });
  triggerDownload(URL.createObjectURL(svgBlob), 'naldografic-vector.svg');
});

// 2. Descargar PNG con fondo transparente (3000px alta resolución)
document.getElementById('btnDownloadPNG').addEventListener('click', () => {
  if (!state.vectorImageObj) return;
  const exportCanvas = document.createElement('canvas');
  const targetW = 3000;
  const aspect = state.vectorImageObj.height / state.vectorImageObj.width;
  exportCanvas.width = targetW;
  exportCanvas.height = Math.round(targetW * aspect);
  const eCtx = exportCanvas.getContext('2d');
  eCtx.drawImage(state.vectorImageObj, 0, 0, exportCanvas.width, exportCanvas.height);
  triggerDownload(exportCanvas.toDataURL('image/png'), 'naldografic-transparente.png');
});

// 3. Descargar Mockup completo (1080x1350)
document.getElementById('btnDownloadMockup').addEventListener('click', () => {
  triggerDownload(canvas.toDataURL('image/png'), 'naldografic-mockup.png');
});

function triggerDownload(url, filename) {
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
}

// --- UTILIDADES DE COLOR ---
function detectCornerColor(imgData) {
  const d = imgData.data;
  return { r: d[0], g: d[1], b: d[2] };
}

function rgbToHex(rgbStr) {
  const match = rgbStr.match(/\d+/g);
  if (!match) return '#000000';
  return '#' + match.slice(0, 3).map(x => parseInt(x, 10).toString(16).padStart(2, '0')).join('');
}

function isColorClose(hex, targetRgb, tolerance) {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return Math.abs(r - targetRgb.r) < tolerance &&
         Math.abs(g - targetRgb.g) < tolerance &&
         Math.abs(b - targetRgb.b) < tolerance;
}
