// Mobile nav toggle — see .site-nav-toggle/.site-nav-inner in
// custom.css for the actual hamburger-to-X animation and full-screen
// overlay styling; this just flips body.is-nav-open and keeps the
// page from scrolling behind the open overlay, same pattern as the
// contact modal below.
document.addEventListener('DOMContentLoaded', () => {
    const toggle = document.querySelector('.site-nav-toggle');
    const nav = document.querySelector('.site-nav');
    if (!toggle || !nav) return;

    function closeMenu() {
        document.body.classList.remove('is-nav-open');
        toggle.setAttribute('aria-expanded', 'false');
        document.body.style.overflow = '';
    }

    function openMenu() {
        document.body.classList.add('is-nav-open');
        toggle.setAttribute('aria-expanded', 'true');
        document.body.style.overflow = 'hidden';
    }

    toggle.addEventListener('click', () => {
        if (document.body.classList.contains('is-nav-open')) {
            closeMenu();
        } else {
            openMenu();
        }
    });

    // Tapping a link inside the open overlay should navigate AND
    // close the menu, rather than leaving it open behind the new page
    // (or on the same page, for anchor/modal-opening links).
    nav.querySelectorAll('.site-nav-links a').forEach(link => {
        link.addEventListener('click', closeMenu);
    });

    document.addEventListener('keydown', e => {
        if (e.key === 'Escape' && document.body.classList.contains('is-nav-open')) closeMenu();
    });
});

// Contact modal — opened by any element carrying
// data-modal-open="modal-contact" (nav/footer links, CTA buttons).
document.addEventListener('DOMContentLoaded', () => {
    const modal = document.getElementById('modal-contact');
    if (!modal) return;

    const content = modal.querySelector('.modal-content');
    const closeBtn = modal.querySelector('.modal-close');
    const triggers = document.querySelectorAll('[data-modal-open="modal-contact"]');
    let lastTrigger = null;

    function openModal(trigger) {
        lastTrigger = trigger;
        modal.removeAttribute('inert');
        modal.setAttribute('aria-hidden', 'false');
        document.body.style.overflow = 'hidden';

        requestAnimationFrame(() => {
            content.classList.remove('animate-in');
            void content.offsetWidth;
            content.classList.add('animate-in');
        });

        closeBtn.focus();
    }

    function closeModal() {
        modal.setAttribute('inert', '');
        modal.setAttribute('aria-hidden', 'true');
        document.body.style.overflow = '';
        content.classList.remove('animate-in');

        if (lastTrigger) lastTrigger.focus();
    }

    triggers.forEach(trigger => {
        trigger.addEventListener('click', e => {
            e.preventDefault();
            openModal(trigger);
        });
    });

    closeBtn?.addEventListener('click', closeModal);

    modal.addEventListener('click', e => {
        if (e.target === modal) closeModal();
    });

    document.addEventListener('keydown', e => {
        if (e.key === 'Escape' && modal.getAttribute('aria-hidden') === 'false') closeModal();
    });
});

// Contact form (submitted via Formspree) — redirect to /thanks/ on success,
// since custom redirects aren't available on Formspree's free plan.
document.addEventListener('DOMContentLoaded', () => {
    document.querySelectorAll('.formspree-form').forEach(form => {
        const submitBtn = form.querySelector('button[type="submit"]');
        const submitLabel = submitBtn?.textContent;

        const status = document.createElement('p');
        status.className = 'form-status';
        status.setAttribute('aria-live', 'polite');
        form.appendChild(status);

        form.addEventListener('submit', async e => {
            e.preventDefault();

            status.textContent = '';
            if (submitBtn) {
                submitBtn.disabled = true;
                submitBtn.textContent = 'Sending…';
            }

            try {
                const response = await fetch(form.action, {
                    method: 'POST',
                    body: new FormData(form),
                    headers: { 'Accept': 'application/json' }
                });

                if (response.ok) {
                    window.location.href = '/thanks/';
                    return;
                }

                const data = await response.json().catch(() => null);
                const message = data?.errors?.map(err => err.message).join(', ');
                status.textContent = message || 'Something went wrong. Please try again in a moment.';
            } catch (err) {
                status.textContent = 'Something went wrong. Please try again in a moment.';
            }

            if (submitBtn) {
                submitBtn.disabled = false;
                submitBtn.textContent = submitLabel;
            }
        });
    });
});

// Homepage "better" carousel (src/index.njk) — a tall "track" section
// with a position: sticky inner layer (see custom.css), so scrolling
// through the track's own extra height steps through the slides
// before the page continues scrolling past it. Driven off real
// scroll position (getBoundingClientRect on every scroll) rather than
// intercepting wheel events, which fights trackpads/mobile/keyboard
// scrolling instead of just working with it.
document.addEventListener('DOMContentLoaded', () => {
    const track = document.querySelector('.hp-better-track');
    const sticky = document.querySelector('.hp-better-sticky');
    const slides = document.querySelectorAll('.hp-better-slide');
    const dots = document.querySelectorAll('.hp-better-dot');
    if (!track || !sticky || !slides.length) return;

    const count = slides.length;
    let activeIndex = -1;

    function setActive(index) {
        if (index === activeIndex) return;
        activeIndex = index;
        slides.forEach((slide, i) => slide.classList.toggle('is-active', i === index));
        dots.forEach((dot, i) => dot.classList.toggle('is-active', i === index));
    }

    function onScroll() {
        const rect = track.getBoundingClientRect();
        const scrollable = track.offsetHeight - sticky.offsetHeight;
        if (scrollable <= 0) return;

        const progress = Math.min(1, Math.max(0, -rect.top / scrollable));
        const index = Math.min(count - 1, Math.floor(progress * count));
        setActive(index);
    }

    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onScroll);

    // Clicking a dot scrolls the page to that slide's position within
    // the track, rather than just toggling visibility — otherwise the
    // very next scroll event would immediately override the click by
    // recomputing the index from the (unchanged) scroll position.
    dots.forEach(dot => {
        dot.addEventListener('click', () => {
            const index = Number(dot.dataset.slide);
            const scrollable = track.offsetHeight - sticky.offsetHeight;
            const targetProgress = (index + 0.5) / count;
            const trackTop = window.scrollY + track.getBoundingClientRect().top;
            window.scrollTo({ top: trackTop + targetProgress * scrollable, behavior: 'smooth' });
        });
    });
});

// Homepage product carousel (Course/Note/Book, src/index.njk) — on phones
// (see .hp-product-grid's own max-width: 640px rule in custom.css) the
// grid becomes a horizontally swipeable, scroll-snapped row with no
// visual cue that there's more to see or where you are in it. These dots
// above it fill that in, the same "N of M" role as .hp-better-dots but
// for a plain native scroll instead of a position: sticky track.
document.addEventListener('DOMContentLoaded', () => {
    const grid = document.querySelector('.hp-product-grid');
    const dots = document.querySelectorAll('.hp-product-dot');
    if (!grid || !dots.length) return;

    function setActive(index) {
        dots.forEach((dot, i) => dot.classList.toggle('is-active', i === index));
    }

    function onScroll() {
        if (grid.clientWidth === 0) return;
        const index = Math.round(grid.scrollLeft / grid.clientWidth);
        setActive(index);
    }

    grid.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onScroll);

    dots.forEach(dot => {
        dot.addEventListener('click', () => {
            const index = Number(dot.dataset.slide);
            grid.scrollTo({ left: index * grid.clientWidth, behavior: 'smooth' });
        });
    });
});
