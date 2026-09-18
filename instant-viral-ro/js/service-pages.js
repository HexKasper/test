'use strict';

// NOTE: `serviceNames` and `escHtml` are already declared globally in
// script.js (which loads before this file on every page). Re-declaring
// `const serviceNames` here used to throw
// "Uncaught SyntaxError: Identifier 'serviceNames' has already been declared"
// the moment this script parsed — which silently killed this ENTIRE file on
// every dedicated service page (cumpara-*.html). That's why the package
// cards never rendered and only the (broken, for these pages) FAQ handler
// from script.js was left running. We simply reuse the existing globals.

// Page to service mapping
const pageMap = {
    'cumpara-urmaritori-instagram': 'ig-followers',
    'cumpara-like-uri-instagram': 'ig-likes',
    'cumpara-urmaritori-tiktok': 'tt-followers',
    'cumpara-like-uri-tiktok': 'tt-likes',
    'cumpara-urmaritori-facebook': 'fb-followers',
    'cumpara-like-uri-facebook': 'fb-likes',
};

document.addEventListener('DOMContentLoaded', () => {
    loadServicePackages();
    // FAQ accordion is handled globally by initFaq() in script.js, which
    // runs on every page (including this one). Previously this file ALSO
    // attached its own click handler (initServiceFaq) to the same buttons,
    // so every click fired both handlers back-to-back. The second handler
    // re-read `aria-expanded` right after the first had just flipped it,
    // so it immediately closed again — and worse, it stamped an inline
    // `max-height:0px` onto every *other* FAQ item, which then blocked
    // script.js's handler (which can't clear that inline style) from ever
    // opening them again. That's the "one opens, then the rest stop
    // working" bug. Removing the duplicate here fixes it.
});

async function loadServicePackages() {
    try {
        const response = await fetch('pricing.json');
        const pricing = await response.json();
        
        const pageKey = window.location.pathname.split('/').pop().replace('.html', '');
        const serviceKey = pageMap[pageKey];
        
        if (!serviceKey || !pricing[serviceKey]) {
            console.warn('No packages found for:', serviceKey);
            return;
        }
        
        const containerId = serviceKey + '-packages';
        const container = document.getElementById(containerId);
        if (!container) {
            console.warn('Container not found:', containerId);
            return;
        }
        
        container.innerHTML = '';
        
        pricing[serviceKey].forEach(pkg => {
            const card = createServicePackageCard(pkg, serviceKey);
            container.appendChild(card);
        });
        
        // Reinitialize package selection after cards are added
        initServicePackageSelection();
        
    } catch (error) {
        console.error('Failed to load service packages:', error);
        showFallbackPackages();
    }
}

function createServicePackageCard(pkg, serviceKey) {
    const article = document.createElement('article');
    article.className = 'pkg-card' + (pkg.popular ? ' featured' : '');
    article.dataset.service = serviceKey;
    article.dataset.qty = pkg.qty;
    article.dataset.price = pkg.price;
    article.dataset.serviceId = pkg.serviceId;
    article.setAttribute('tabindex', '0');
    article.setAttribute('role', 'button');
    article.setAttribute('aria-pressed', 'false');
    
    const pricePer1000 = ((pkg.price / pkg.qty) * 1000).toFixed(2);
    const saveText = pkg.discount > 0 ? `SAVE ${pkg.discount}%` : '';
    
    article.innerHTML = `
        <div class="pkg-header">
            <span class="pkg-discount-badge">-${pkg.discount}%</span>
            <span class="pkg-badge ${pkg.popular ? 'popular-badge' : ''}">${pkg.popular ? '🔥 ' : ''}${pkg.badge}</span>
        </div>
        <div class="pkg-qty">${pkg.qty.toLocaleString('en-US')}</div>
        <div class="pkg-type">${serviceNames[serviceKey]}</div>
        <div class="pkg-features">
            ${pkg.features.map(f => `
                <div class="feat">
                    <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M2.5 7l3 3 6-6" stroke="#6C63FF" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>
                    ${escHtml(f)}
                </div>
            `).join('')}
        </div>
        <div class="pkg-price-block">
            <div class="pkg-price-old"><span class="pkg-price-old-amount">${pkg.oldPrice.toFixed(2)} lei</span></div>
            <div class="pkg-price-main">${pkg.price.toFixed(2)} lei</div>
            <div class="pkg-price-per">≈ ${pricePer1000} lei per 1.000</div>
            ${saveText ? `<div class="pkg-price-save">${saveText}</div>` : ''}
        </div>
        <div class="pkg-price-row">
            <button class="btn btn-select">Cumpără</button>
        </div>
    `;
    
    return article;
}

function initServicePackageSelection() {
    document.querySelectorAll('.pkg-card').forEach(card => {
        // Remove old event listeners by cloning
        const newCard = card.cloneNode(true);
        card.parentNode.replaceChild(newCard, card);
        
        newCard.addEventListener('click', function(e) {
            const { service, qty } = this.dataset;

            // Vibrate on mobile for tactile feedback
            if (navigator.vibrate && window.innerWidth < 768) {
                navigator.vibrate(10);
            }

            // These pages don't have their own checkout form, so we send the
            // user to the homepage with this exact package pre-selected and
            // scroll them straight to the order/checkout section.
            const params = new URLSearchParams({ service, qty });
            window.location.href = `index.html?${params.toString()}#order`;
        });
        
        // Add keyboard support
        newCard.addEventListener('keydown', function(e) {
            if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                this.click();
            }
        });
        
        // 3D tilt effect
        newCard.addEventListener('mousemove', function(e) {
            const rect = this.getBoundingClientRect();
            const x = e.clientX - rect.left;
            const y = e.clientY - rect.top;
            this.style.setProperty('--mouse-x', `${x}px`);
            this.style.setProperty('--mouse-y', `${y}px`);
            
            const centerX = rect.width / 2;
            const centerY = rect.height / 2;
            const rotateX = ((y - centerY) / centerY) * -4;
            const rotateY = ((x - centerX) / centerX) * 4;
            this.style.transform = `perspective(1000px) rotateX(${rotateX}deg) rotateY(${rotateY}deg) translateY(-2px)`;
        });
        
        newCard.addEventListener('mouseleave', function() {
            this.style.transform = '';
        });
    });
}

function showFallbackPackages() {
    // Defensive fallback: if pricing.json genuinely fails to load (network
    // hiccup, deploy issue, etc.), don't leave the user staring at an empty
    // grid. Offer a real way forward — a direct link to the packages on the
    // homepage — instead of just a "reload" button.
    const containers = document.querySelectorAll('.pkg-grid');
    containers.forEach(container => {
        if (container.children.length === 0) {
            container.innerHTML = `
                <div class="pkg-card" style="grid-column:1/-1;text-align:center;padding:2rem;display:flex;flex-direction:column;align-items:center;gap:0.75rem;">
                    <p style="color:var(--text-sub);">Nu am putut încărca pachetele chiar acum. Te rugăm să reîncerci sau să alegi un pachet direct din pagina principală.</p>
                    <div style="display:flex;gap:0.75rem;flex-wrap:wrap;justify-content:center;">
                        <button onclick="location.reload()" class="btn btn-ghost">
                            Reîmprospătează
                        </button>
                        <a href="index.html#packages" class="btn btn-primary">
                            Vezi toate pachetele
                        </a>
                    </div>
                </div>
            `;
        }
    });
}

// Make the page->service mapping available globally (used only in this
// file, but exposed for consistency / potential reuse elsewhere).
window.pageMap = pageMap;