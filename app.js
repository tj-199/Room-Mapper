/**
 * Room Mapper Pro - Core Engine
 * Architecture: CSS 3D transformed background image, isolated canvas drawing.
 */

// --- DOM Elements ---
const canvas = document.getElementById('mainCanvas');
const ctx = canvas.getContext('2d');
const bgImage = document.getElementById('bgImage');
const stageContainer = document.getElementById('stage');
const transformOverlay = document.getElementById('transformOverlay');
const transformDialog = document.getElementById('transformDialog');
const sidebar = document.getElementById('sidebar');
const btnUpload = document.getElementById('btn-upload');
const photoInput = document.getElementById('photoInput');
const btnDelete = document.getElementById('btn-delete');

// --- Global State ---
let features = [];
let dimensions = [];
let state = 'SELECT'; 
let currentFeature = null;
let selectedFeatureId = null;
let showDimensions = true;

let dimLine1 = null; 
let dimLine2 = null;

// Transform variables
const pins = [
    document.getElementById('pin0'), document.getElementById('pin1'),
    document.getElementById('pin2'), document.getElementById('pin3')
];
let activePin = null;

// ============================================================
// PHOTO UPLOAD & TRANSFORM WORKFLOW
// ============================================================
btnUpload.addEventListener('click', () => photoInput.click());

photoInput.addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (event) => {
        bgImage.onload = () => {
            bgImage.style.display = 'block';
            bgImage.style.transform = 'none'; // reset previous transforms
            resizeStage();
            startTransformFlow();
        };
        bgImage.src = event.target.result;
    };
    reader.readAsDataURL(file);
});

function resizeStage() {
    if (!bgImage.src) return;
    const viewport = document.getElementById('viewport');
    const vWidth = viewport.clientWidth;
    const vHeight = viewport.clientHeight - 80; // account for bottom controls

    // Natural aspect ratio of the image
    const imgRatio = bgImage.naturalWidth / bgImage.naturalHeight;
    const viewRatio = vWidth / vHeight;

    let targetW, targetH;
    if (imgRatio > viewRatio) {
        targetW = vWidth;
        targetH = vWidth / imgRatio;
    } else {
        targetH = vHeight;
        targetW = vHeight * imgRatio;
    }

    stageContainer.style.width = `${targetW}px`;
    stageContainer.style.height = `${targetH}px`;
    canvas.width = targetW;
    canvas.height = targetH;
    render();
}

// Ensure resize triggers correctly
window.addEventListener('resize', resizeStage);

function startTransformFlow() {
    state = 'TRANSFORM';
    transformOverlay.style.display = 'block';
    transformDialog.style.display = 'block';
    
    // Position pins at 10% inset from corners
    const w = canvas.width;
    const h = canvas.height;
    setPinPos(pins[0], w*0.1, h*0.1);
    setPinPos(pins[1], w*0.9, h*0.1);
    setPinPos(pins[2], w*0.9, h*0.9);
    setPinPos(pins[3], w*0.1, h*0.9);
}

document.getElementById('btn-skip-transform').addEventListener('click', () => {
    endTransformFlow();
});

document.getElementById('btn-apply-transform').addEventListener('click', () => {
    applyTransform();
    endTransformFlow();
});

function endTransformFlow() {
    transformOverlay.style.display = 'none';
    transformDialog.style.display = 'none';
    document.getElementById('btn-wall').disabled = false;
    document.getElementById('btn-feature').disabled = false;
    document.getElementById('btn-dimension').disabled = false;
    state = 'SELECT';
}

function applyTransform() {
    const w = canvas.width;
    const h = canvas.height;
    
    // Source points: Where the pins are currently located
    const src = pins.map(p => {
        return { x: parseFloat(p.style.left), y: parseFloat(p.style.top) };
    });
    
    // Destination points: A perfect rectangle (we map to the bounding box of the pins)
    const minX = Math.min(...src.map(p=>p.x));
    const maxX = Math.max(...src.map(p=>p.x));
    const minY = Math.min(...src.map(p=>p.y));
    const maxY = Math.max(...src.map(p=>p.y));
    
    const dst = [
        { x: minX, y: minY },
        { x: maxX, y: minY },
        { x: maxX, y: maxY },
        { x: minX, y: maxY }
    ];

    // From perspective.js
    const matrix = getTransformMatrix(src, dst);
    if (matrix) {
        bgImage.style.transform = `matrix3d(${matrix.join(',')})`;
    }
}

// Pin Dragging Logic
pins.forEach(pin => {
    pin.addEventListener('mousedown', (e) => {
        if (state !== 'TRANSFORM') return;
        activePin = pin;
        e.stopPropagation();
    });
});
document.addEventListener('mousemove', (e) => {
    if (!activePin) return;
    const rect = stageContainer.getBoundingClientRect();
    let x = e.clientX - rect.left;
    let y = e.clientY - rect.top;
    setPinPos(activePin, x, y);
});
document.addEventListener('mouseup', () => { activePin = null; });

function setPinPos(pin, x, y) {
    pin.style.left = `${x}px`;
    pin.style.top = `${y}px`;
}


// ============================================================
// CORE INTERACTION (DRAWING & SELECTION)
// ============================================================

canvas.addEventListener('mousedown', handleMouseDown);
canvas.addEventListener('mousemove', handleMouseMove);

function handleMouseDown(e) {
    if (state === 'TRANSFORM') return;
    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;

    // --- Selection Mode ---
    if (state === 'SELECT') {
        const hit = getFeatureAtPoint(x, y);
        if (hit) {
            selectFeature(hit.id);
        } else {
            selectFeature(null);
        }
        return;
    }

    // --- Dimensioning Mode ---
    if (state === 'DIM_SELECT_LINE1' || state === 'DIM_SELECT_LINE2') {
        const hit = findNearestEdge(x, y);
        if (!hit) return;

        if (state === 'DIM_SELECT_LINE1') {
            dimLine1 = hit;
            state = 'DIM_SELECT_LINE2';
            updateStatus('Click a PARALLEL line on another feature...');
        } else {
            dimLine2 = hit;
            const isParallel = areLinesParallel(dimLine1.edge, dimLine2.edge);
            if (!isParallel) {
                updateStatus('Lines must be parallel! Try again.');
                dimLine2 = null; state = 'DIM_SELECT_LINE1'; dimLine1 = null;
                return;
            }

            // Check Over Constraint
            const axis = ['left', 'right'].includes(dimLine1.edge) ? 'x' : 'y';
            if (isAxisConstrained(dimLine1.featureId, axis) && isAxisConstrained(dimLine2.featureId, axis)) {
                const calcDist = getCalculatedDistance(dimLine1.featureId, dimLine1.edge, dimLine2.featureId, dimLine2.edge);
                const addRef = confirm(`This axis is already fully constrained. The calculated distance is ${calcDist}".\n\nWould you like to add this as a [Reference Dimension]?`);
                if (addRef) {
                    addDimensionObj(calcDist, true);
                } else {
                    dimLine1 = null; dimLine2 = null; state = 'SELECT'; render();
                }
                return;
            }

            const value = prompt('Enter the distance between these two lines (in inches):');
            if (value && !isNaN(parseFloat(value))) {
                addDimensionObj(parseFloat(value), false);
                recalcRealPositions();
            } else {
                dimLine1 = null; dimLine2 = null; state = 'SELECT';
            }
            updateStatus('Dimension added.');
            render();
            buildSidebar();
        }
        render();
        return;
    }

    // --- Drawing Mode (Wall / Feature) ---
    if (state === 'DRAWING_WALL' || state === 'DRAWING_FEATURE') {
        if (!currentFeature) {
            currentFeature = {
                id: Date.now(), type: state === 'DRAWING_WALL' ? 'wall' : 'feature',
                label: '', x1: x, y1: y, x2: x, y2: y,
                realW: 0, realH: 0, realX: 0, realY: 0
            };
        } else {
            currentFeature.x2 = x;
            currentFeature.y2 = y;
            normalizeRect(currentFeature);

            // If it's the master wall, enforce wall-specific logic
            const isWall = currentFeature.type === 'wall';
            const label = prompt('Enter a label:', isWall ? 'Wall' : 'Feature');
            const w = prompt('Enter REAL width (inches):');
            const h = prompt('Enter REAL height (inches):');
            
            if (label) currentFeature.label = label;
            if (w && !isNaN(parseFloat(w))) currentFeature.realW = parseFloat(w);
            if (h && !isNaN(parseFloat(h))) currentFeature.realH = parseFloat(h);

            features.push(currentFeature);
            
            // Sort features so walls are always at the beginning (index 0)
            // This ensures they are drawn first (in the background) 
            // and hit-tested last (so smaller features on top are clickable).
            features.sort((a, b) => {
                if (a.type === 'wall' && b.type !== 'wall') return -1;
                if (b.type === 'wall' && a.type !== 'wall') return 1;
                return 0; // maintain relative order of others
            });

            selectFeature(currentFeature.id);

            currentFeature = null;
            state = 'SELECT';
            updateStatus('Select objects or draw more.');
            render();
        }
    }
}

function handleMouseMove(e) {
    if (!currentFeature && state !== 'DIM_SELECT_LINE1' && state !== 'DIM_SELECT_LINE2') return;
    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;

    if (currentFeature) {
        currentFeature.x2 = x;
        currentFeature.y2 = y;
    }
    render();
}

function addDimensionObj(value, isReference) {
    dimensions.push({
        id: Date.now(),
        from: { ...dimLine1 },
        to: { ...dimLine2 },
        value: value,
        visible: true,
        isReference: isReference
    });
    dimLine1 = null; dimLine2 = null; state = 'SELECT';
}


// ============================================================
// HIT DETECTION & SELECTION
// ============================================================
function getFeatureAtPoint(x, y) {
    // Reverse loop to hit top-most elements first
    for (let i = features.length - 1; i >= 0; i--) {
        const f = features[i];
        if (x >= f.x1 && x <= f.x2 && y >= f.y1 && y <= f.y2) {
            return f;
        }
    }
    return null;
}

function selectFeature(id) {
    selectedFeatureId = id;
    if (id) {
        btnDelete.style.display = 'inline-block';
        btnDelete.disabled = false;
    } else {
        btnDelete.style.display = 'none';
    }
    render();
    buildSidebar();
}


// ============================================================
// DELETION LOGIC (CASCADING)
// ============================================================
btnDelete.addEventListener('click', deleteSelectedFeature);

function deleteSelectedFeature() {
    if (!selectedFeatureId) return;
    
    // Cascading Delete: Remove any dimensions pointing to this feature
    dimensions = dimensions.filter(d => 
        d.from.featureId !== selectedFeatureId && 
        d.to.featureId !== selectedFeatureId
    );
    
    // Remove the feature
    features = features.filter(f => f.id !== selectedFeatureId);
    
    selectedFeatureId = null;
    selectFeature(null);
    recalcRealPositions();
    render();
}


// ============================================================
// BUTTON LISTENERS
// ============================================================
document.getElementById('btn-wall').addEventListener('click', () => { state = 'DRAWING_WALL'; currentFeature = null; });
document.getElementById('btn-feature').addEventListener('click', () => { state = 'DRAWING_FEATURE'; currentFeature = null; });
document.getElementById('btn-dimension').addEventListener('click', () => { state = 'DIM_SELECT_LINE1'; });
document.getElementById('btn-export').addEventListener('click', exportDXF);


// ============================================================
// RENDERING
// ============================================================
function render() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    features.forEach(f => drawRect(f, false, f.id === selectedFeatureId));

    if (currentFeature) drawRect(currentFeature, true, false);

    if (showDimensions) {
        dimensions.forEach(d => { if (d.visible) drawDimension(d); });
    }

    if (state === 'DIM_SELECT_LINE1' || state === 'DIM_SELECT_LINE2') highlightEdges();
    if (dimLine1) drawEdgeHighlight(dimLine1, '#facc15');
}

function drawRect(f, isPreview, isSelected) {
    ctx.beginPath();
    ctx.lineWidth = isSelected ? 4 : 2;
    const color = f.type === 'wall' ? '#22c55e' : '#38bdf8';
    
    ctx.strokeStyle = isSelected ? '#ffffff' : color;
    if (isSelected) ctx.shadowColor = color;
    if (isSelected) ctx.shadowBlur = 10;
    else ctx.shadowBlur = 0;

    if (isPreview) ctx.setLineDash([5, 5]);
    else ctx.setLineDash([]);

    const w = f.x2 - f.x1;
    const h = f.y2 - f.y1;
    ctx.rect(f.x1, f.y1, w, h);
    ctx.stroke();

    ctx.shadowBlur = 0; // reset
    if (!isPreview) {
        ctx.fillStyle = f.type === 'wall' ? 'rgba(34, 197, 94, 0.08)' : 'rgba(56, 189, 248, 0.08)';
        ctx.fill();
        ctx.setLineDash([]);
        ctx.font = isSelected ? 'bold 13px Inter, sans-serif' : '12px Inter, sans-serif';
        ctx.fillStyle = isSelected ? '#ffffff' : color;
        const dims = f.realW && f.realH ? ` (${f.realW}" × ${f.realH}")` : '';
        ctx.fillText((f.label || f.type) + dims, f.x1 + 4, f.y1 + 14);
    }
}

// ... Includes Dimension drawing logic and DXF Export exactly as before.

// ============================================================
// SIDEBAR EDITOR
// ============================================================
function buildSidebar() {
    sidebar.style.display = 'block';
    
    // Always build the Ledger first
    let html = '<h3 class="side-title">Features Ledger</h3>';
    
    features.forEach(f => {
        const isSelected = f.id === selectedFeatureId;
        const bg = isSelected ? 'rgba(56, 189, 248, 0.15)' : 'rgba(255,255,255,0.05)';
        const border = isSelected ? '1px solid #38bdf8' : '1px solid transparent';
        
        html += `
            <div data-id="${f.id}" class="ledger-item" style="padding:0.75rem;margin-bottom:0.5rem;background:${bg};border:${border};border-radius:8px;font-size:0.85rem;cursor:pointer; transition:all 0.2s;">
                <strong style="color:${f.type === 'wall' ? '#22c55e' : '#38bdf8'}">${f.label || f.type}</strong><br>
                <span style="color:#94a3b8">Real: ${f.realW}" × ${f.realH}"</span>
            </div>
        `;
    });

    // Check if we need to append the Editor below the ledger
    if (selectedFeatureId) {
        const f = features.find(feat => feat.id === selectedFeatureId);
        if (f) {
            html += `
                <div style="margin-top:2rem; border-top: 1px solid #334155; padding-top:1rem;">
                    <h3 class="side-title">Edit Selected</h3>
                    <div style="margin-bottom:1rem">
                        <label style="color:#94a3b8;font-size:0.8rem">Label</label>
                        <input id="edit-label" type="text" value="${f.label}" style="width:100%;padding:0.5rem;background:#0f172a;color:white;border:1px solid #334155;border-radius:4px">
                    </div>
                    <div style="margin-bottom:1rem; display:flex; gap:0.5rem">
                        <div>
                            <label style="color:#94a3b8;font-size:0.8rem">Width (in)</label>
                            <input id="edit-w" type="number" value="${f.realW}" style="width:100%;padding:0.5rem;background:#0f172a;color:white;border:1px solid #334155;border-radius:4px">
                        </div>
                        <div>
                            <label style="color:#94a3b8;font-size:0.8rem">Height (in)</label>
                            <input id="edit-h" type="number" value="${f.realH}" style="width:100%;padding:0.5rem;background:#0f172a;color:white;border:1px solid #334155;border-radius:4px">
                        </div>
                    </div>
                    <div style="color:#94a3b8;font-size:0.8rem;margin-bottom:1rem">
                        X: ${f.realX.toFixed(2)}" | Y: ${f.realY.toFixed(2)}"
                    </div>
                    <button id="btn-save-edit" class="btn primary" style="width:100%">Save Edits</button>
                </div>
            `;
        }
    }

    // Dimension toggle
    html += `
        <div style="margin-top:1.5rem; border-top: 1px solid #334155; padding-top:1rem;">
            <label style="display:flex;align-items:center;gap:0.5rem;cursor:pointer;font-size:0.85rem;">
                <input type="checkbox" id="dimToggle" ${showDimensions ? 'checked' : ''}>
                Show Dimensions
            </label>
        </div>
    `;

    sidebar.innerHTML = html;

    // Attach Event Listeners
    const ledgerItems = sidebar.querySelectorAll('.ledger-item');
    ledgerItems.forEach(item => {
        item.addEventListener('click', () => {
            selectFeature(parseInt(item.dataset.id));
        });
        item.addEventListener('mouseover', () => { if(!item.style.border.includes('solid #38bdf8')) item.style.background = 'rgba(255,255,255,0.1)' });
        item.addEventListener('mouseout', () => { if(!item.style.border.includes('solid #38bdf8')) item.style.background = 'rgba(255,255,255,0.05)' });
    });

    const btnSave = document.getElementById('btn-save-edit');
    if (btnSave && selectedFeatureId) {
        btnSave.addEventListener('click', () => {
            const f = features.find(feat => feat.id === selectedFeatureId);
            f.label = document.getElementById('edit-label').value;
            f.realW = parseFloat(document.getElementById('edit-w').value);
            f.realH = parseFloat(document.getElementById('edit-h').value);
            recalcRealPositions();
            render();
            buildSidebar();
            updateStatus('Edits saved.');
        });
    }

    document.getElementById('dimToggle').addEventListener('change', (e) => {
        showDimensions = e.target.checked;
        render();
    });
}

// ============================================================
// UTILITIES & PREVIOUS MATH (Copied from previous valid state)
// ============================================================
function normalizeRect(f) {
    const minX = Math.min(f.x1, f.x2); const maxX = Math.max(f.x1, f.x2);
    const minY = Math.min(f.y1, f.y2); const maxY = Math.max(f.y1, f.y2);
    f.x1 = minX; f.y1 = minY; f.x2 = maxX; f.y2 = maxY;
}
function updateStatus(msg) {
    const logo = document.querySelector('.logo');
    logo.textContent = msg;
    clearTimeout(logo._timer);
    logo._timer = setTimeout(() => { logo.textContent = 'ROOM MAPPER PRO'; }, 3000);
}
function areLinesParallel(edge1, edge2) {
    const v = ['left', 'right']; const h = ['top', 'bottom'];
    if (v.includes(edge1) && v.includes(edge2)) return true;
    if (h.includes(edge1) && h.includes(edge2)) return true;
    return false;
}
function getEdges(f) {
    return {
        left:   { x1: f.x1, y1: f.y1, x2: f.x1, y2: f.y2, orientation: 'vertical' },
        right:  { x1: f.x2, y1: f.y1, x2: f.x2, y2: f.y2, orientation: 'vertical' },
        top:    { x1: f.x1, y1: f.y1, x2: f.x2, y2: f.y1, orientation: 'horizontal' },
        bottom: { x1: f.x1, y1: f.y2, x2: f.x2, y2: f.y2, orientation: 'horizontal' }
    };
}
function findNearestEdge(mx, my) {
    let best = null; let bestDist = 15;
    features.forEach(f => {
        const edges = getEdges(f);
        for (const [name, edge] of Object.entries(edges)) {
            const dist = distToSegment(mx, my, edge);
            if (dist < bestDist) { bestDist = dist; best = { featureId: f.id, edge: name, orientation: edge.orientation }; }
        }
    }); return best;
}
function distToSegment(px, py, seg) {
    if (seg.orientation === 'vertical') {
        if (py >= Math.min(seg.y1, seg.y2) && py <= Math.max(seg.y1, seg.y2)) return Math.abs(px - seg.x1);
        return Infinity;
    } else {
        if (px >= Math.min(seg.x1, seg.x2) && px <= Math.max(seg.x1, seg.x2)) return Math.abs(py - seg.y1);
        return Infinity;
    }
}
function isAxisConstrained(featureId, axis) {
    const wall = features.find(f => f.type === 'wall');
    if (wall && featureId === wall.id) return true;
    return dimensions.some(d => {
        if (d.isReference) return false;
        if (d.from.featureId !== featureId && d.to.featureId !== featureId) return false;
        const edge = d.from.featureId === featureId ? d.from.edge : d.to.edge;
        if (axis === 'x') return ['left', 'right'].includes(edge);
        if (axis === 'y') return ['top', 'bottom'].includes(edge);
        return false;
    });
}
function getCalculatedDistance(f1Id, e1Edge, f2Id, e2Edge) {
    recalcRealPositions();
    const f1 = features.find(f => f.id === f1Id); const f2 = features.find(f => f.id === f2Id);
    if (!f1 || !f2) return 0;
    let p1, p2;
    if (['left', 'right'].includes(e1Edge)) {
        p1 = f1.realX + (e1Edge === 'right' ? f1.realW : 0); p2 = f2.realX + (e2Edge === 'right' ? f2.realW : 0);
    } else {
        p1 = f1.realY + (e1Edge === 'top' ? f1.realH : 0); p2 = f2.realY + (e2Edge === 'top' ? f2.realH : 0);
    }
    return Math.abs(p1 - p2);
}
function recalcRealPositions() {
    const wall = features.find(f => f.type === 'wall');
    if (!wall) return;
    features.forEach(f => {
        if (f.type === 'wall') { f.realX = 0; f.realY = 0; return; }
        const featureDims = dimensions.filter(d => !d.isReference && (d.from.featureId === f.id || d.to.featureId === f.id));
        featureDims.forEach(dim => {
            const isFrom = dim.from.featureId === f.id;
            const myEdge = isFrom ? dim.from.edge : dim.to.edge;
            const otherSide = isFrom ? dim.to : dim.from;
            const otherFeature = features.find(feat => feat.id === otherSide.featureId);
            if (!otherFeature) return;
            const otherEdge = otherSide.edge;
            if (['left', 'right'].includes(myEdge)) {
                let baseX = otherFeature.realX; if (otherEdge === 'right') baseX += otherFeature.realW;
                if (myEdge === 'left') f.realX = baseX + dim.value; else f.realX = baseX + dim.value - f.realW;
            }
            if (['top', 'bottom'].includes(myEdge)) {
                let baseY = otherFeature.realY; if (otherEdge === 'top') baseY += otherFeature.realH;
                if (myEdge === 'bottom') f.realY = baseY + dim.value; else f.realY = baseY + dim.value - f.realH;
            }
        });
    });
}
function exportDXF() {
    const wall = features.find(f => f.type === 'wall');
    if (!wall) { alert('Please define a wall first.'); return; }
    recalcRealPositions();
    let dxf = '0\nSECTION\n2\nHEADER\n9\n$INSUNITS\n70\n1\n0\nENDSEC\n0\nSECTION\n2\nTABLES\n0\nTABLE\n2\nLAYER\n70\n10\n';
    dxf += '0\nLAYER\n2\nWALL\n70\n0\n62\n3\n6\nCONTINUOUS\n0\nLAYER\n2\nFEATURES\n70\n0\n62\n5\n6\nCONTINUOUS\n0\nLAYER\n2\nDIMENSIONS\n70\n0\n62\n2\n6\nCONTINUOUS\n0\nENDTAB\n0\nENDSEC\n0\nSECTION\n2\nENTITIES\n';
    features.forEach(f => {
        const layer = f.type === 'wall' ? 'WALL' : 'FEATURES';
        dxf += drawDXFRect(f.realX, f.realY, f.realW, f.realH, layer);
        dxf += drawDXFText(f.realX + 1, f.realY + f.realH - 2, `${f.label || f.type} (${f.realW}" x ${f.realH}")`, layer, 2);
    });
    dimensions.forEach(dim => {
        if (!dim.visible) return;
        const f1 = features.find(f => f.id === dim.from.featureId); const f2 = features.find(f => f.id === dim.to.featureId);
        if (!f1 || !f2) return;
        const e1Edge = dim.from.edge; const e2Edge = dim.to.edge; const textVal = dim.isReference ? `[${dim.value}"]` : `${dim.value}"`;
        let x1r, y1r, x2r, y2r;
        if (['left', 'right'].includes(e1Edge)) {
            x1r = f1.realX + (e1Edge === 'right' ? f1.realW : 0); x2r = f2.realX + (e2Edge === 'right' ? f2.realW : 0); const midY = Math.max(f1.realY, f2.realY) + 2;
            dxf += drawDXFLine(x1r, midY, x2r, midY, 'DIMENSIONS'); dxf += drawDXFText((x1r + x2r) / 2, midY + 1, textVal, 'DIMENSIONS', 1.5);
        } else {
            y1r = f1.realY + (e1Edge === 'top' ? f1.realH : 0); y2r = f2.realY + (e2Edge === 'top' ? f2.realH : 0); const midX = Math.max(f1.realX, f2.realX) + 2;
            dxf += drawDXFLine(midX, y1r, midX, y2r, 'DIMENSIONS'); dxf += drawDXFText(midX + 1, (y1r + y2r) / 2, textVal, 'DIMENSIONS', 1.5);
        }
    });
    dxf += '0\nENDSEC\n0\nEOF\n';
    const blob = new Blob([dxf], { type: 'application/dxf' }); const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url; a.download = 'room_mapping.dxf'; a.click(); URL.revokeObjectURL(url);
    updateStatus('DXF exported!');
}
function drawDXFRect(x, y, w, h, layer) { return `${drawDXFLine(x,y,x+w,y,layer)}${drawDXFLine(x+w,y,x+w,y+h,layer)}${drawDXFLine(x+w,y+h,x,y+h,layer)}${drawDXFLine(x,y+h,x,y,layer)}`; }
function drawDXFLine(x1, y1, x2, y2, layer) { return `0\nLINE\n8\n${layer}\n10\n${x1}\n20\n${y1}\n30\n0\n11\n${x2}\n21\n${y2}\n31\n0\n`; }
function drawDXFText(x, y, text, layer, height) { return `0\nTEXT\n8\n${layer}\n10\n${x}\n20\n${y}\n30\n0\n40\n${height}\n1\n${text}\n`; }
function drawDimension(dim) {
    const f1 = features.find(f => f.id === dim.from.featureId); const f2 = features.find(f => f.id === dim.to.featureId);
    if (!f1 || !f2) return;
    const e1 = getEdges(f1)[dim.from.edge]; const e2 = getEdges(f2)[dim.to.edge];
    ctx.save(); ctx.strokeStyle = '#facc15'; ctx.fillStyle = '#facc15'; ctx.lineWidth = 1; ctx.setLineDash([3, 3]);
    ctx.font = dim.isReference ? 'italic 13px Inter, sans-serif' : 'bold 13px Inter, sans-serif';
    const textVal = dim.isReference ? `[${dim.value}"]` : `${dim.value}"`;
    if (e1.orientation === 'vertical') {
        const midY = (Math.max(e1.y1, e2.y1) + Math.min(e1.y2, e2.y2)) / 2; const leftX = Math.min(e1.x1, e2.x1); const rightX = Math.max(e1.x1, e2.x1);
        ctx.beginPath(); ctx.moveTo(leftX, midY); ctx.lineTo(rightX, midY); ctx.stroke();
        drawArrow(leftX, midY, 'right'); drawArrow(rightX, midY, 'left'); ctx.setLineDash([]); ctx.fillText(textVal, (leftX + rightX) / 2 - 10, midY - 6);
    } else {
        const midX = (Math.max(e1.x1, e2.x1) + Math.min(e1.x2, e2.x2)) / 2; const topY = Math.min(e1.y1, e2.y1); const botY = Math.max(e1.y1, e2.y1);
        ctx.beginPath(); ctx.moveTo(midX, topY); ctx.lineTo(midX, botY); ctx.stroke();
        drawArrow(midX, topY, 'down'); drawArrow(midX, botY, 'up'); ctx.setLineDash([]); ctx.fillText(textVal, midX + 6, (topY + botY) / 2 + 4);
    }
    ctx.restore();
}
function drawArrow(x, y, dir) {
    const s = 6; ctx.beginPath(); ctx.setLineDash([]);
    switch (dir) {
        case 'right': ctx.moveTo(x, y); ctx.lineTo(x+s, y-s/2); ctx.lineTo(x+s, y+s/2); break;
        case 'left':  ctx.moveTo(x, y); ctx.lineTo(x-s, y-s/2); ctx.lineTo(x-s, y+s/2); break;
        case 'down':  ctx.moveTo(x, y); ctx.lineTo(x-s/2, y+s); ctx.lineTo(x+s/2, y+s); break;
        case 'up':    ctx.moveTo(x, y); ctx.lineTo(x-s/2, y-s); ctx.lineTo(x+s/2, y-s); break;
    } ctx.closePath(); ctx.fill();
}
function highlightEdges() {
    features.forEach(f => {
        const edges = getEdges(f);
        for (const [name, edge] of Object.entries(edges)) {
            ctx.save(); ctx.strokeStyle = 'rgba(250, 204, 21, 0.3)'; ctx.lineWidth = 4; ctx.setLineDash([]);
            ctx.beginPath(); ctx.moveTo(edge.x1, edge.y1); ctx.lineTo(edge.x2, edge.y2); ctx.stroke(); ctx.restore();
        }
    });
}
function drawEdgeHighlight(hit, color) {
    const f = features.find(feat => feat.id === hit.featureId); if (!f) return;
    const edge = getEdges(f)[hit.edge];
    ctx.save(); ctx.strokeStyle = color; ctx.lineWidth = 3; ctx.setLineDash([]);
    ctx.beginPath(); ctx.moveTo(edge.x1, edge.y1); ctx.lineTo(edge.x2, edge.y2); ctx.stroke(); ctx.restore();
}
