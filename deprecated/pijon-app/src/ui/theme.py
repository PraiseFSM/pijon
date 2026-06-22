# ── Toolbar ───────────────────────────────────────────────────────────────────
TOOLBAR_BG           = "#2C3E50"
TOOLBAR_BTN_BG       = "#3D5166"
TOOLBAR_BTN_BORDER   = "#4A6278"
TOOLBAR_BTN_HOVER    = "#4A6278"
TOOLBAR_BTN_PRESSED  = "#1A5276"
TOOLBAR_BTN_CHECKED  = "#1ABC9C"
TOOLBAR_TEXT         = "#ECF0F1"
TOOLBAR_LABEL_COLOR  = "#ADB6C4"

# ── Left panel (student list / furniture palette) ─────────────────────────────
PANEL_BG             = "#F7F9FC"
PANEL_HEADER_COLOR   = "#2C3E50"
PANEL_ITEM_BG        = "#FFFFFF"
PANEL_ITEM_BORDER    = "#E0E8F0"
PANEL_ITEM_SELECTED  = "#D6EAF8"

# ── Classroom backdrop ────────────────────────────────────────────────────────
GRID_BG              = "#F0F4F8"
GRID_LINE            = "#D5DCE8"

# ── Desk states ───────────────────────────────────────────────────────────────
DESK_TEXT            = "#000000"
DESK_FIXTURE_TEXT    = "#666666"
DESK_OCCUPIED_BG     = "#FFFFFF"
DESK_OCCUPIED_BORDER = "#2196F3"
DESK_FIXTURE_BG      = "#ECEFF1"
DESK_FIXTURE_BORDER  = "#9E9E9E"
DESK_LOCKED_BG       = "#FFF8E1"
DESK_LOCKED_BORDER   = "#FF9800"
DESK_SELECTED_BG     = "#FFFF00"
DESK_SELECTED_BORDER = "#FF5722"

# ── Constraint violation overlay ──────────────────────────────────────────────
VIOLATION_BAD_BG     = "#FFCDD2"
VIOLATION_BAD_BORDER = "#C62828"
VIOLATION_OK_BG      = "#C8E6C9"
VIOLATION_OK_BORDER  = "#2E7D32"

# ── Drag / drop ───────────────────────────────────────────────────────────────
DRAG_PREVIEW_BG      = "#2196F3"
DRAG_PREVIEW_BORDER  = "#1565C0"
DRAG_PREVIEW_TEXT    = "#FFFFFF"
DROP_TARGET_BG       = "#A5D6A7"
DROP_TARGET_BORDER   = "#388E3C"

# ── Furniture palette fallback (no image) ─────────────────────────────────────
FURNITURE_FALLBACK   = "#4CAF50"

# ── Neighbor highlight ───────────────────────────────────────────────────────
NEIGHBOR_SOURCE_BG     = "#BBDEFB"  # source desk (clicked)
NEIGHBOR_SOURCE_BORDER = "#0D47A1"
NEIGHBOR_TARGET_BG     = "#FFF3E0"  # neighbor desks
NEIGHBOR_TARGET_BORDER = "#E65100"
NEIGHBOR_NONE_BG       = "#F5F5F5"  # non-neighbors while source is active (empty desks)
NEIGHBOR_NONE_BORDER   = "#BDBDBD"

# ── Tab bar ───────────────────────────────────────────────────────────────────
TAB_BAR_BG           = "#1E2D3D"
TAB_SELECTED_BG      = "#2C3E50"
TAB_TEXT             = "#ECF0F1"


def toolbar_stylesheet() -> str:
    return f"""
        QWidget#toolbar {{
            background-color: {TOOLBAR_BG};
        }}
        QPushButton {{
            background-color: {TOOLBAR_BTN_BG};
            color: {TOOLBAR_TEXT};
            border: 1px solid {TOOLBAR_BTN_BORDER};
            padding: 4px 10px;
            border-radius: 3px;
            font-size: 12px;
        }}
        QPushButton:hover {{
            background-color: {TOOLBAR_BTN_HOVER};
        }}
        QPushButton:pressed {{
            background-color: {TOOLBAR_BTN_PRESSED};
        }}
        QPushButton:checked {{
            background-color: {TOOLBAR_BTN_CHECKED};
            border-color: {TOOLBAR_BTN_CHECKED};
        }}
        QLabel {{
            color: {TOOLBAR_LABEL_COLOR};
            font-size: 12px;
        }}
        QSpinBox, QDoubleSpinBox, QComboBox {{
            background-color: {TOOLBAR_BTN_BG};
            color: {TOOLBAR_TEXT};
            border: 1px solid {TOOLBAR_BTN_BORDER};
            padding: 2px 6px;
            border-radius: 3px;
            font-size: 12px;
        }}
    """
