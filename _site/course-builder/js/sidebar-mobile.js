// Mobile sidebar drawer — swipe-in/out plus a tap target, for the
// #sidebar-peek-catcher / #sidebar-backdrop markup in index.html and the
// #sidebar.is-open / body.sidebar-open styling in css/style.css. Closed
// state isn't fully hidden — #sidebar itself stays translated so a thin
// PEEK_WIDTH sliver of its own real edge stays visible/tappable, rather
// than a separate hamburger icon (see the CSS's own translateX comment;
// this PEEK_WIDTH must match the 14px baked into that translateX there).
//
// Self-contained: no imports from course-builder.js and nothing here is
// imported back, since the drawer is pure UI chrome with no dependency on
// course/lesson state. Loaded as its own <script type="module"> so a
// DOMContentLoaded wrapper isn't needed — module scripts already run after
// the DOM is parsed.
//
// Edge-swipe to open is deliberately narrow (see EDGE_ZONE below) rather
// than a swipe-from-anywhere gesture: #workspace is itself horizontally
// scrollable (the card canvas), so a broad "any rightward drag opens the
// drawer" rule would fight normal card-canvas panning. Swipe-to-close,
// once the drawer is already open, is bound broadly instead — the
// backdrop covers the rest of the app while open, so there's no canvas to
// conflict with.

const sidebar = document.getElementById('sidebar');
const peekCatcher = document.getElementById('sidebar-peek-catcher');
const backdrop = document.getElementById('sidebar-backdrop');

if (sidebar && peekCatcher && backdrop) {
    const mql = window.matchMedia('(max-width: 768px)');
    const PEEK_WIDTH = 14; // must match #sidebar's closed-state translateX in style.css

    function isOpen() {
        return document.body.classList.contains('sidebar-open');
    }

    function openSidebar() {
        document.body.classList.add('sidebar-open');
        sidebar.classList.add('is-open');
        peekCatcher.setAttribute('aria-expanded', 'true');
    }

    function closeSidebar() {
        document.body.classList.remove('sidebar-open');
        sidebar.classList.remove('is-open');
        peekCatcher.setAttribute('aria-expanded', 'false');
    }

    // No toggle — peekCatcher itself is only ever visible/tappable while
    // closed (see body.sidebar-open #sidebar-peek-catcher in style.css),
    // so a tap on it only ever means "open".
    peekCatcher.addEventListener('click', openSidebar);
    backdrop.addEventListener('click', closeSidebar);

    document.addEventListener('keydown', e => {
        if (e.key === 'Escape' && isOpen()) closeSidebar();
    });

    // Closing on resize past the breakpoint stops the drawer from being
    // stuck "open" (with its fixed positioning and the body scroll lock
    // below) if the mobile CSS stops applying underneath it — a rotated
    // device or a resized window, not just a page load at desktop width.
    mql.addEventListener('change', e => {
        if (!e.matches) closeSidebar();
    });

    // Swipe gesture — a single touch-tracking state machine shared by both
    // directions, since only one gesture (open OR close) is ever possible
    // at a time depending on the drawer's current state.
    const EDGE_ZONE = PEEK_WIDTH + 10; // px from the left screen edge that can start an "open" swipe — a little wider than the peek sliver itself, easier to grab
    const OPEN_THRESHOLD = 60; // px of rightward drag to commit to opening
    const CLOSE_THRESHOLD = 60; // px of leftward drag to commit to closing
    const MAX_VERTICAL_DRIFT = 60; // px of vertical movement that cancels the gesture (it's a scroll, not a swipe)

    let tracking = false;
    let startX = 0;
    let startY = 0;

    document.addEventListener('touchstart', e => {
        if (!mql.matches) return;
        if (e.touches.length !== 1) return;

        const x = e.touches[0].clientX;
        const y = e.touches[0].clientY;

        if (isOpen()) {
            // Anywhere counts once open — the backdrop/sidebar already own
            // the touch surface at that point.
            tracking = true;
        } else if (x <= EDGE_ZONE) {
            tracking = true;
        } else {
            tracking = false;
            return;
        }

        startX = x;
        startY = y;
    }, { passive: true });

    document.addEventListener('touchmove', e => {
        if (!tracking || e.touches.length !== 1) return;

        const dx = e.touches[0].clientX - startX;
        const dy = e.touches[0].clientY - startY;

        if (Math.abs(dy) > MAX_VERTICAL_DRIFT) {
            tracking = false;
            return;
        }

        if (!isOpen() && dx >= OPEN_THRESHOLD) {
            openSidebar();
            tracking = false;
        } else if (isOpen() && dx <= -CLOSE_THRESHOLD) {
            closeSidebar();
            tracking = false;
        }
    }, { passive: true });

    document.addEventListener('touchend', () => {
        tracking = false;
    });
}
