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
let selectedDimId = null;
let showDimensions = true;

let activeDragDimId = null;
let dragStartX = 0;
let dragStartY = 0;

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
    updatePinLines();
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
    document.getElementById('btn-dimension').disabled = false;
    state = 'SELECT';
    updateFeatureButtonState();
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
    updatePinLines();
});
document.addEventListener('mouseup', () => { 
    activePin = null; 
    activeDragDimId = null; 
});

function setPinPos(pin, x, y) {
    pin.style.left = `${x}px`;
    pin.style.top = `${y}px`;
}

function updatePinLines() {
    const polyline = document.getElementById('pinPolyline');
    if (!polyline) return;
    const coords = pins.map(p => `${parseFloat(p.style.left)},${parseFloat(p.style.top)}`);
    // Close the polygon by repeating pin0
    coords.push(`${parseFloat(pins[0].style.left)},${parseFloat(pins[0].style.top)}`);
    polyline.setAttribute('points', coords.join(' '));
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
        // Check dimensions first (small targets that sit on top of large feature rects)
        const dimHit = getDimensionAtPoint(x, y);
        if (dimHit) {
            selectDimension(dimHit.id);
            activeDragDimId = dimHit.id;
            dragStartX = x;
            dragStartY = y;
            return;
        }
        const hit = getFeatureAtPoint(x, y);
        if (hit) {
            selectFeature(hit.id);
            return;
        }
        // Nothing hit — deselect all
        selectFeature(null);
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
                    render();
                    buildSidebar();
                } else {
                    dimLine1 = null; dimLine2 = null; state = 'SELECT'; render();
                }
                return;
            }

            const value = prompt('Enter the distance between these two lines (in inches):');
            const parsed = parseDimension(value);
            if (parsed !== null) {
                addDimensionObj(parsed, false);
                recalcRealPositions();
                syncPixelsFromReal();
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
                realW: 0, realH: 0, realX: 0, realY: 0,
                isWidthDriven: false, isHeightDriven: false
            };
        } else {
            currentFeature.x2 = x;
            currentFeature.y2 = y;
            normalizeRect(currentFeature);

            const isWall = currentFeature.type === 'wall';

            if (isWall) {
                // Wall requires manual dimensions (establishes scale)
                const label = prompt('Enter a label:', 'Wall');
                const w = prompt('Enter REAL width (inches):');
                const h = prompt('Enter REAL height (inches):');
                if (label) currentFeature.label = label;
                const parsedW = parseDimension(w);
                const parsedH = parseDimension(h);
                if (parsedW !== null) currentFeature.realW = parsedW;
                if (parsedH !== null) currentFeature.realH = parsedH;
            } else {
                // Feature dimensions are auto-calculated from wall scale
                const featureCount = features.filter(f => f.type === 'feature').length;
                currentFeature.label = `Feature ${featureCount + 1}`;
                autoCalcDims(currentFeature);
            }

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
            updateFeatureButtonState();

            currentFeature = null;
            state = 'SELECT';
            updateStatus(isWall ? 'Wall placed. You can now add features.' : 'Feature placed. Edit details in sidebar.');
            recalcRealPositions();
            syncPixelsFromReal();
            render();
        }
    }
}

function handleMouseMove(e) {
    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;

    if (activeDragDimId) {
        const dim = dimensions.find(d => d.id === activeDragDimId);
        if (dim) {
            const f1 = features.find(f => f.id === dim.from.featureId);
            const e1 = getEdges(f1)[dim.from.edge];
            
            if (e1.orientation === 'vertical') {
                dim.offset += (y - dragStartY);
            } else {
                dim.offset += (x - dragStartX);
            }
            dragStartX = x;
            dragStartY = y;
            render();
            return;
        }
    }

    if (!currentFeature && state !== 'DIM_SELECT_LINE1' && state !== 'DIM_SELECT_LINE2') return;

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
        isReference: isReference,
        offset: 0
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
    selectedDimId = null; // Clear dimension selection
    if (id) {
        btnDelete.style.display = 'inline-block';
        btnDelete.disabled = false;
    } else if (!selectedDimId) {
        btnDelete.style.display = 'none';
    }
    render();
    buildSidebar();
}

function selectDimension(id) {
    selectedDimId = id;
    selectedFeatureId = null; // Clear feature selection
    btnDelete.style.display = 'inline-block';
    btnDelete.disabled = false;
    render();
    buildSidebar();
}


// ============================================================
// DELETION LOGIC (CASCADING)
// ============================================================
btnDelete.addEventListener('click', deleteSelected);

function deleteSelected() {
    if (selectedDimId) {
        // Delete selected dimension
        dimensions = dimensions.filter(d => d.id !== selectedDimId);
        selectedDimId = null;
        btnDelete.style.display = 'none';
        recalcRealPositions();
        syncPixelsFromReal();
        render();
        buildSidebar();
        return;
    }
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
    syncPixelsFromReal();
    updateFeatureButtonState();
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
        dimensions.forEach(d => { if (d.visible) drawDimension(d, d.id === selectedDimId); });
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

    // Check if we need to append the Feature Editor below the ledger
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
                        <div style="flex:1">
                            <label style="color:#94a3b8;font-size:0.8rem; display:flex; justify-content:space-between; align-items:center;">
                                Width (in)
                                <span style="font-size:0.65rem; color:${f.isWidthDriven ? '#38bdf8' : '#94a3b8'}">
                                    <input type="checkbox" id="check-w-driven" ${f.isWidthDriven ? 'checked' : ''}> Driven
                                </span>
                            </label>
                            <input id="edit-w" type="text" value="${f.realW}" 
                                style="width:100%;padding:0.5rem;background:#0f172a;color:${f.isWidthDriven ? '#38bdf8' : 'white'};border:1px solid #334155;border-radius:4px" 
                                placeholder="e.g. 35+1/2" ${f.isWidthDriven ? 'readonly' : ''}>
                        </div>
                        <div style="flex:1">
                            <label style="color:#94a3b8;font-size:0.8rem; display:flex; justify-content:space-between; align-items:center;">
                                Height (in)
                                <span style="font-size:0.65rem; color:${f.isHeightDriven ? '#38bdf8' : '#94a3b8'}">
                                    <input type="checkbox" id="check-h-driven" ${f.isHeightDriven ? 'checked' : ''}> Driven
                                </span>
                            </label>
                            <input id="edit-h" type="text" value="${f.realH}" 
                                style="width:100%;padding:0.5rem;background:#0f172a;color:${f.isHeightDriven ? '#38bdf8' : 'white'};border:1px solid #334155;border-radius:4px" 
                                placeholder="e.g. 35+1/2" ${f.isHeightDriven ? 'readonly' : ''}>
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

    // Dimension Editor (when a dimension is selected)
    if (selectedDimId) {
        const dim = dimensions.find(d => d.id === selectedDimId);
        if (dim) {
            const f1 = features.find(f => f.id === dim.from.featureId);
            const f2 = features.find(f => f.id === dim.to.featureId);
            const fromLabel = f1 ? (f1.label || f1.type) : '?';
            const toLabel = f2 ? (f2.label || f2.type) : '?';
            const isRef = dim.isReference;
            html += `
                <div style="margin-top:2rem; border-top: 1px solid #634a15; padding-top:1rem;">
                    <h3 class="side-title" style="color:#facc15">${isRef ? 'Reference Dimension' : 'Edit Dimension'}</h3>
                    <div style="color:#94a3b8;font-size:0.8rem;margin-bottom:0.75rem">
                        ${fromLabel} (${dim.from.edge}) → ${toLabel} (${dim.to.edge})
                    </div>
                    <div style="margin-bottom:1rem">
                        <label style="color:#94a3b8;font-size:0.8rem">Distance (in)</label>
                        <input id="edit-dim-value" type="text" value="${dim.value}"
                            style="width:100%;padding:0.5rem;background:#0f172a;color:${isRef ? '#64748b' : '#facc15'};border:1px solid ${isRef ? '#334155' : '#634a15'};border-radius:4px;font-weight:bold"
                            placeholder="e.g. 35+1/2" ${isRef ? 'disabled' : ''}>
                    </div>
                    ${isRef ? `
                        <div style="color:#94a3b8;font-size:0.8rem;font-style:italic;margin-bottom:1rem;padding:0.5rem;background:rgba(250,204,21,0.05);border-radius:4px;border:1px solid #334155">
                            🔒 This value is calculated from driving dimensions and cannot be edited. Delete a driving dimension first to unlock this axis.
                        </div>
                    ` : `
                        <button id="btn-save-dim" class="btn primary" style="width:100%;background:#facc15;color:#0f172a">Save Dimension</button>
                    `}
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
            
            const newW = parseDimension(document.getElementById('edit-w').value);
            const newH = parseDimension(document.getElementById('edit-h').value);
            
            if (!f.isWidthDriven && newW !== null) f.realW = newW;
            if (!f.isHeightDriven && newH !== null) f.realH = newH;
            
            if (f.type === 'wall') {
                // Wall scale changed — re-snap all features to new scale
                features.forEach(feat => { if (feat.type === 'feature') snapToScale(feat); });
            } else {
                snapToScale(f);
            }
            recalcRealPositions();
            syncPixelsFromReal();
            render();
            buildSidebar();
            updateStatus('Edits saved.');
        });
    }

    // Driven checkbox listeners
    const checkW = document.getElementById('check-w-driven');
    const checkH = document.getElementById('check-h-driven');
    if (checkW) {
        checkW.addEventListener('change', (e) => {
            const f = features.find(feat => feat.id === selectedFeatureId);
            if (f) {
                f.isWidthDriven = e.target.checked;
                if (!f.isWidthDriven) {
                    // Sync realW to current calculated width and demote over-constraints
                    f.realW = Math.round(Math.abs(f.edges.right - f.edges.left) * 100) / 100;
                    autoDemote(f.id, 'x');
                }
                recalcRealPositions();
                syncPixelsFromReal();
                render();
                buildSidebar();
            }
        });
    }
    if (checkH) {
        checkH.addEventListener('change', (e) => {
            const f = features.find(feat => feat.id === selectedFeatureId);
            if (f) {
                f.isHeightDriven = e.target.checked;
                if (!f.isHeightDriven) {
                    // Sync realH to current calculated height and demote over-constraints
                    f.realH = Math.round(Math.abs(f.edges.top - f.edges.bottom) * 100) / 100;
                    autoDemote(f.id, 'y');
                }
                recalcRealPositions();
                syncPixelsFromReal();
                render();
                buildSidebar();
            }
        });
    }

    // Dimension save handler
    const btnSaveDim = document.getElementById('btn-save-dim');
    if (btnSaveDim && selectedDimId) {
        btnSaveDim.addEventListener('click', () => {
            const dim = dimensions.find(d => d.id === selectedDimId);
            if (!dim) return;
            const newVal = parseDimension(document.getElementById('edit-dim-value').value);
            if (newVal !== null) dim.value = newVal;
            recalcRealPositions();
            syncPixelsFromReal();
            render();
            buildSidebar();
            updateStatus('Dimension updated.');
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

// --- Dimension Parser (supports fractions like "35+1/2" or "35 1/2") ---
function parseDimension(str) {
    if (str === null || str === undefined) return null;
    str = String(str).trim();
    if (str === '') return null;

    // Pure decimal/integer: "35" or "35.5"
    if (/^-?\d+(\.\d+)?$/.test(str)) return parseFloat(str);

    // Pure fraction: "1/2" or "3/4"
    const pureMatch = str.match(/^(-?\d+)\/(\d+)$/);
    if (pureMatch) {
        const denom = parseFloat(pureMatch[2]);
        return denom === 0 ? null : parseFloat(pureMatch[1]) / denom;
    }

    // Mixed number: "35+1/2", "35 1/2", "35-1/2" (meaning 35 and 1/2)
    const mixedMatch = str.match(/^(-?\d+(?:\.\d+)?)\s*[+ ]\s*(\d+)\/(\d+)$/);
    if (mixedMatch) {
        const whole = parseFloat(mixedMatch[1]);
        const num = parseFloat(mixedMatch[2]);
        const denom = parseFloat(mixedMatch[3]);
        if (denom === 0) return null;
        return whole + (whole < 0 ? -1 : 1) * (num / denom);
    }

    // Fallback to parseFloat for partial matches like "35.5in"
    const fallback = parseFloat(str);
    return isNaN(fallback) ? null : fallback;
}

// --- Scale Utilities ---
function getScale() {
    const wall = features.find(f => f.type === 'wall');
    if (!wall || !wall.realW || !wall.realH) return null;
    const pixelW = wall.x2 - wall.x1;
    const pixelH = wall.y2 - wall.y1;
    return { x: pixelW / wall.realW, y: pixelH / wall.realH };
}

function autoCalcDims(feature) {
    const scale = getScale();
    const wall = features.find(f => f.type === 'wall');
    if (!scale || !wall) return;
    
    const pixelW = feature.x2 - feature.x1;
    const pixelH = feature.y2 - feature.y1;
    
    // Size
    feature.realW = Math.round(pixelW / scale.x * 100) / 100;
    feature.realH = Math.round(pixelH / scale.y * 100) / 100;
    
    // Position relative to wall anchor (bottom-left)
    feature.realX = Math.round((feature.x1 - wall.x1) / scale.x * 100) / 100;
    feature.realY = Math.round((wall.y2 - feature.y2) / scale.y * 100) / 100;
}

function snapToScale(feature) {
    const scale = getScale();
    if (!scale) return;
    feature.x2 = feature.x1 + feature.realW * scale.x;
    feature.y2 = feature.y1 + feature.realH * scale.y;
}

function updateFeatureButtonState() {
    const hasWall = features.some(f => f.type === 'wall');
    document.getElementById('btn-feature').disabled = !hasWall;
}

// --- Parametric Sync: Push real-world positions back to pixel coords ---
function syncPixelsFromReal() {
    const scale = getScale();
    if (!scale) return;
    const wall = features.find(f => f.type === 'wall');
    if (!wall) return;

    features.forEach(f => {
        if (f.type === 'wall') return; 

        // Use resolved edges to update pixel coordinates
        if (f.edgesResolved.left) {
            f.x1 = wall.x1 + f.edges.left * scale.x;
        }
        if (f.edgesResolved.right) {
            f.x2 = wall.x1 + f.edges.right * scale.x;
        }
        if (f.edgesResolved.bottom) {
            // Real Y=0 is wall bottom; pixel Y increases downward
            f.y2 = wall.y2 - f.edges.bottom * scale.y;
        }
        if (f.edgesResolved.top) {
            f.y1 = wall.y2 - f.edges.top * scale.y;
        }

        // If one edge is NOT resolved but the size is fixed, calculate from the other edge
        if (f.edgesResolved.left && !f.edgesResolved.right && !f.isWidthDriven) {
            f.x2 = f.x1 + f.realW * scale.x;
        } else if (!f.edgesResolved.left && f.edgesResolved.right && !f.isWidthDriven) {
            f.x1 = f.x2 - f.realW * scale.x;
        }

        if (f.edgesResolved.bottom && !f.edgesResolved.top && !f.isHeightDriven) {
            f.y1 = f.y2 - f.realH * scale.y;
        } else if (!f.edgesResolved.bottom && f.edgesResolved.top && !f.isHeightDriven) {
            f.y2 = f.y1 + f.realH * scale.y;
        }
        
        // Update realX/realY for compatibility with other functions
        f.realX = f.edges.left;
        f.realY = f.edges.bottom;
    });
}

// --- Dimension Hit Detection ---
function getDimensionAtPoint(px, py) {
    const hitRadius = 12;
    for (let i = dimensions.length - 1; i >= 0; i--) {
        const dim = dimensions[i];
        if (!dim.visible) continue;
        const f1 = features.find(f => f.id === dim.from.featureId);
        const f2 = features.find(f => f.id === dim.to.featureId);
        if (!f1 || !f2) continue;

        const e1 = getEdges(f1)[dim.from.edge];
        const e2 = getEdges(f2)[dim.to.edge];
        const offset = dim.offset || 0;

        if (e1.orientation === 'vertical') {
            const midY = (Math.max(e1.y1, e2.y1) + Math.min(e1.y2, e2.y2)) / 2 + offset;
            const leftX = Math.min(e1.x1, e2.x1);
            const rightX = Math.max(e1.x1, e2.x1);
            // Check proximity to the horizontal dim line
            if (px >= leftX - hitRadius && px <= rightX + hitRadius &&
                Math.abs(py - midY) < hitRadius) {
                return dim;
            }
        } else {
            const midX = (Math.max(e1.x1, e2.x1) + Math.min(e1.x2, e2.x2)) / 2 + offset;
            const topY = Math.min(e1.y1, e2.y1);
            const botY = Math.max(e1.y1, e2.y1);
            // Check proximity to the vertical dim line
            if (py >= topY - hitRadius && py <= botY + hitRadius &&
                Math.abs(px - midX) < hitRadius) {
                return dim;
            }
        }
    }
    return null;
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
    
    const f = features.find(feat => feat.id === featureId);
    if (!f) return false;

    // We only care if it's constrained by an actual dimension (from edgesConstrained)
    if (axis === 'x') {
        if (f.isWidthDriven) return f.edgesConstrained.left && f.edgesConstrained.right;
        return f.edgesConstrained.left || f.edgesConstrained.right;
    }
    if (axis === 'y') {
        if (f.isHeightDriven) return f.edgesConstrained.top && f.edgesConstrained.bottom;
        return f.edgesConstrained.top || f.edgesConstrained.bottom;
    }
    return false;
}
function calcDistanceBetweenFeatures(f1Id, e1Edge, f2Id, e2Edge) {
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
function getCalculatedDistance(f1Id, e1Edge, f2Id, e2Edge) {
    recalcRealPositions();
    const dist = calcDistanceBetweenFeatures(f1Id, e1Edge, f2Id, e2Edge);
    return Math.round(dist * 1000) / 1000;
}
function autoDemote(featureId, axis) {
    const axisEdges = axis === 'x' ? ['left', 'right'] : ['top', 'bottom'];
    const secondaryEdge = axis === 'x' ? 'right' : 'top';
    
    // Find driving dimensions for this feature and axis
    const activeDims = dimensions.filter(d => !d.isReference && 
        ((d.from.featureId === featureId && axisEdges.includes(d.from.edge)) || 
         (d.to.featureId === featureId && axisEdges.includes(d.to.edge)))
    );
    
    if (activeDims.length > 1) {
        // Preference: Demote the one attached to the secondary edge (Right or Top)
        const toDemote = activeDims.find(d => 
            (d.from.featureId === featureId && d.from.edge === secondaryEdge) || 
            (d.to.featureId === featureId && d.to.edge === secondaryEdge)
        );
        if (toDemote) {
            toDemote.isReference = true;
            updateStatus(`Over-constraint: ${secondaryEdge} dimension demoted to Reference.`);
        }
    }
}
function recalcRealPositions() {
    const wall = features.find(f => f.type === 'wall');
    if (!wall) return;
    
    // Reset all non-wall positions to ensure clean recalculation
    features.forEach(f => {
        f.edges = { left: 0, right: 0, top: 0, bottom: 0 };
        f.edgesResolved = { left: false, right: false, top: false, bottom: false };
        f.edgesConstrained = { left: false, right: false, top: false, bottom: false };
        
        if (f.type === 'wall') {
            f.edges = { left: 0, right: f.realW, top: f.realH, bottom: 0 };
            f.edgesResolved = { left: true, right: true, top: true, bottom: true };
            f.edgesConstrained = { left: true, right: true, top: true, bottom: true };
            f.realX = 0; f.realY = 0;
        }
    });

    const activeDims = dimensions.filter(d => !d.isReference);

    // Multi-pass resolution algorithm (Resolving the Constraint Graph)
    let madeProgress = true;
    let passes = 0;

    while (madeProgress && passes < 20) {
        madeProgress = false;
        passes++;

        // 1. Resolve driving dimensions
        activeDims.forEach(dim => {
            const f1 = features.find(f => f.id === dim.from.featureId);
            const f2 = features.find(f => f.id === dim.to.featureId);
            if (!f1 || !f2) return;

            const e1 = dim.from.edge;
            const e2 = dim.to.edge;
            const isY = ['top', 'bottom'].includes(e1);

            // Use pixel-based hints to determine direction (sign)
            // For X axis, if f2.edge is visually right of f1.edge, real value should be higher
            // For Y axis, if f2.edge is visually higher (smaller pixel Y), real value should be higher
            const p1 = getEdgePixelValue(f1, e1);
            const p2 = getEdgePixelValue(f2, e2);
            
            let direction = p2 >= p1 ? 1 : -1;
            if (isY) direction *= -1; // Flip for Y axis because pixel Y is inverted vs real Y

            if (f1.edgesResolved[e1] && !f2.edgesResolved[e2]) {
                f2.edges[e2] = f1.edges[e1] + (direction * dim.value);
                f2.edgesResolved[e2] = true;
                f2.edgesConstrained[e2] = true;
                madeProgress = true;
            } else if (!f1.edgesResolved[e1] && f2.edgesResolved[e2]) {
                f1.edges[e1] = f2.edges[e2] - (direction * dim.value);
                f1.edgesResolved[e1] = true;
                f1.edgesConstrained[e1] = true;
                madeProgress = true;
            }
        });

        // 2. Resolve internal feature consistency (Fixed Size Logic)
        features.forEach(f => {
            if (f.type === 'wall') return;

            // X-Axis
            if (!f.isWidthDriven) {
                if (f.edgesResolved.left && !f.edgesResolved.right) {
                    f.edges.right = f.edges.left + f.realW;
                    f.edgesResolved.right = true;
                    f.edgesConstrained.right = f.edgesConstrained.left;
                    madeProgress = true;
                } else if (!f.edgesResolved.left && f.edgesResolved.right) {
                    f.edges.left = f.edges.right - f.realW;
                    f.edgesResolved.left = true;
                    f.edgesConstrained.left = f.edgesConstrained.right;
                    madeProgress = true;
                }
            } else {
                // Driven width: calculate realW if both edges resolved
                if (f.edgesResolved.left && f.edgesResolved.right) {
                    const oldW = f.realW;
                    f.realW = Math.abs(f.edges.right - f.edges.left);
                    if (Math.abs(f.realW - oldW) > 0.001) madeProgress = true;
                }
            }

            // Y-Axis
            if (!f.isHeightDriven) {
                if (f.edgesResolved.bottom && !f.edgesResolved.top) {
                    f.edges.top = f.edges.bottom + f.realH;
                    f.edgesResolved.top = true;
                    f.edgesConstrained.top = f.edgesConstrained.bottom;
                    madeProgress = true;
                } else if (!f.edgesResolved.bottom && f.edgesResolved.top) {
                    f.edges.bottom = f.edges.top - f.realH;
                    f.edgesResolved.bottom = true;
                    f.edgesConstrained.bottom = f.edgesConstrained.top;
                    madeProgress = true;
                }
            } else {
                // Driven height: calculate realH if both edges resolved
                if (f.edgesResolved.bottom && f.edgesResolved.top) {
                    const oldH = f.realH;
                    f.realH = Math.abs(f.edges.top - f.edges.bottom);
                    if (Math.abs(f.realH - oldH) > 0.001) madeProgress = true;
                }
            }
        });
    }

    // --- Final Fallback Pass (The "Sticky" Logic) ---
    // If an axis has NO dimensions, fall back to the initial realX/realY/realW/realH
    // If a driven axis has only 1 dimension, use the sketched width/height as fallback
    features.forEach(f => {
        if (f.type === 'wall') return;

        // X-Axis Fallbacks
        if (!f.edgesResolved.left && !f.edgesResolved.right) {
            f.edges.left = f.realX;
            f.edges.right = f.realX + f.realW;
            f.edgesResolved.left = true;
            f.edgesResolved.right = true;
        } else if (f.edgesResolved.left && !f.edgesResolved.right) {
            f.edges.right = f.edges.left + f.realW;
            f.edgesResolved.right = true;
        } else if (!f.edgesResolved.left && f.edgesResolved.right) {
            f.edges.left = f.edges.right - f.realW;
            f.edgesResolved.left = true;
        }

        // Y-Axis Fallbacks
        if (!f.edgesResolved.top && !f.edgesResolved.bottom) {
            f.edges.bottom = f.realY;
            f.edges.top = f.realY + f.realH;
            f.edgesResolved.bottom = true;
            f.edgesResolved.top = true;
        } else if (f.edgesResolved.bottom && !f.edgesResolved.top) {
            f.edges.top = f.edges.bottom + f.realH;
            f.edgesResolved.top = true;
        } else if (!f.edgesResolved.bottom && f.edgesResolved.top) {
            f.edges.bottom = f.edges.top - f.realH;
            f.edgesResolved.bottom = true;
        }
    });

    // Sync legacy properties for backward compatibility
    features.forEach(f => {
        if (f.edgesResolved.left) f.realX = f.edges.left;
        if (f.edgesResolved.bottom) f.realY = f.edges.bottom;
    });

    // Auto-update reference dimensions based on new positions
    dimensions.filter(d => d.isReference).forEach(dim => {
        const dist = calcDistanceBetweenFeatures(dim.from.featureId, dim.from.edge, dim.to.featureId, dim.to.edge);
        dim.value = Math.round(dist * 1000) / 1000;
    });
}

function getEdgePixelValue(f, edge) {
    if (edge === 'left') return f.x1;
    if (edge === 'right') return f.x2;
    if (edge === 'top') return f.y1;
    if (edge === 'bottom') return f.y2;
    return 0;
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
    const scale = getScale();
    dimensions.forEach(dim => {
        if (!dim.visible) return;
        const f1 = features.find(f => f.id === dim.from.featureId); const f2 = features.find(f => f.id === dim.to.featureId);
        if (!f1 || !f2) return;
        
        const e1Edge = dim.from.edge; const e2Edge = dim.to.edge; 
        const textVal = dim.isReference ? `[${dim.value}"]` : `${dim.value}"`;
        const offset = dim.offset || 0;
        
        const edges1 = getEdges(f1); const edges2 = getEdges(f2);
        const e1 = edges1[e1Edge]; const e2 = edges2[e2Edge];

        let x1r, y1r, x2r, y2r;
        if (e1.orientation === 'vertical') {
            // Real X coordinates are already solved
            x1r = f1.edges[e1Edge]; 
            x2r = f2.edges[e2Edge];
            
            // Calculate visual midY including offset
            const midY_visual = (Math.max(e1.y1, e2.y1) + Math.min(e1.y2, e2.y2)) / 2 + offset;
            // Convert visual midY to realY (Wall bottom is real 0)
            const midY_real = (wall.y2 - midY_visual) / scale.y;
            
            dxf += drawDXFLine(x1r, midY_real, x2r, midY_real, 'DIMENSIONS'); 
            dxf += drawDXFText((x1r + x2r) / 2, midY_real + 1, textVal, 'DIMENSIONS', 1.5);
        } else {
            // Real Y coordinates are already solved
            y1r = f1.edges[e1Edge];
            y2r = f2.edges[e2Edge];
            
            // Calculate visual midX including offset
            const midX_visual = (Math.max(e1.x1, e2.x1) + Math.min(e1.x2, e2.x2)) / 2 + offset;
            // Convert visual midX to realX (Wall left is real 0)
            const midX_real = (midX_visual - wall.x1) / scale.x;
            
            dxf += drawDXFLine(midX_real, y1r, midX_real, y2r, 'DIMENSIONS'); 
            dxf += drawDXFText(midX_real + 1, (y1r + y2r) / 2, textVal, 'DIMENSIONS', 1.5);
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
function drawDimension(dim, isSelected) {
    const f1 = features.find(f => f.id === dim.from.featureId); const f2 = features.find(f => f.id === dim.to.featureId);
    if (!f1 || !f2) return;
    const e1 = getEdges(f1)[dim.from.edge]; const e2 = getEdges(f2)[dim.to.edge];
    const color = isSelected ? '#ffffff' : '#facc15';
    const offset = dim.offset || 0;
    ctx.save();
    ctx.strokeStyle = color; ctx.fillStyle = color;
    ctx.lineWidth = isSelected ? 3 : 1;
    ctx.setLineDash(isSelected ? [] : [3, 3]);
    if (isSelected) { ctx.shadowColor = '#facc15'; ctx.shadowBlur = 12; }
    ctx.font = dim.isReference ? 'italic 13px Inter, sans-serif' : 'bold 13px Inter, sans-serif';
    const textVal = dim.isReference ? `[${dim.value}"]` : `${dim.value}"`;
    if (e1.orientation === 'vertical') {
        const midY = (Math.max(e1.y1, e2.y1) + Math.min(e1.y2, e2.y2)) / 2 + offset; const leftX = Math.min(e1.x1, e2.x1); const rightX = Math.max(e1.x1, e2.x1);
        ctx.beginPath(); ctx.moveTo(leftX, midY); ctx.lineTo(rightX, midY); ctx.stroke();
        ctx.shadowBlur = 0;
        drawArrow(leftX, midY, 'right'); drawArrow(rightX, midY, 'left'); ctx.setLineDash([]); ctx.fillText(textVal, (leftX + rightX) / 2 - 10, midY - 6);
    } else {
        const midX = (Math.max(e1.x1, e2.x1) + Math.min(e1.x2, e2.x2)) / 2 + offset; const topY = Math.min(e1.y1, e2.y1); const botY = Math.max(e1.y1, e2.y1);
        ctx.beginPath(); ctx.moveTo(midX, topY); ctx.lineTo(midX, botY); ctx.stroke();
        ctx.shadowBlur = 0;
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
