document.addEventListener('DOMContentLoaded', () => {
    initMobileHeaderMenu();

    const footerSlot = document.querySelector('[data-include="footer"]');

    if (!footerSlot) {
        return;
    }

    fetch('footer.html')
        .then((response) => {
            if (!response.ok) {
                throw new Error(`Footer load failed: ${response.status}`);
            }

            return response.text();
        })
        .then((html) => {
            footerSlot.outerHTML = html;
        })
        .catch((error) => {
            console.error(error);
        });
});

function initMobileHeaderMenu() {
    const headerContent = document.querySelector('.site-header-content');
    const nav = document.querySelector('.site-nav');

    if (!headerContent || !nav || headerContent.querySelector('.site-menu-toggle')) {
        return;
    }

    const toggle = document.createElement('button');
    toggle.className = 'site-menu-toggle';
    toggle.type = 'button';
    toggle.setAttribute('aria-label', 'Open menu');
    toggle.setAttribute('aria-expanded', 'false');
    toggle.innerHTML = '<span class="site-menu-text">Menu</span><span class="site-menu-bars" aria-hidden="true"><span></span><span></span><span></span></span>';

    headerContent.insertBefore(toggle, nav);

    const closeMenu = () => {
        headerContent.classList.remove('is-nav-open');
        toggle.setAttribute('aria-expanded', 'false');
        toggle.setAttribute('aria-label', 'Open menu');
    };

    toggle.addEventListener('click', (event) => {
        event.stopPropagation();
        const isOpen = headerContent.classList.toggle('is-nav-open');
        toggle.setAttribute('aria-expanded', String(isOpen));
        toggle.setAttribute('aria-label', isOpen ? 'Close menu' : 'Open menu');
    });

    nav.addEventListener('click', (event) => {
        if (event.target.closest('a')) {
            closeMenu();
        }
    });

    document.addEventListener('click', (event) => {
        if (!headerContent.contains(event.target)) {
            closeMenu();
        }
    });

    document.addEventListener('keydown', (event) => {
        if (event.key === 'Escape') {
            closeMenu();
        }
    });
}
