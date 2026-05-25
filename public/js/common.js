/* ==========================
   LOAD NAVBAR
========================== */
async function loadNav() {

    const container = document.getElementById('nav-container');
    if (!container) return;

    const nav = await fetch('/partials/nav.html')
        .then(r => r.text());

    container.innerHTML = nav;
    setActiveNav();
}

/* ==========================
   ACTIVE NAV LINK
========================== */
function setActiveNav() {

    const path = window.location.pathname;

    document.querySelectorAll('.nav-link').forEach(link => {

        if (link.getAttribute('href') === path) {
            link.classList.add('active');
        }
    });
}

function showToast(message, type = 'success') {

    const container = document.getElementById('toast-container');

    const id = 'toast-' + Date.now();

    const toastHTML = `
        <div id="${id}" class="toast align-items-center text-bg-${type} border-0 mb-2" role="alert">
            <div class="d-flex">
                <div class="toast-body">
                    ${message}
                </div>
                <button type="button" class="btn-close btn-close-white me-2 m-auto"
                        data-bs-dismiss="toast"></button>
            </div>
        </div>
    `;

    container.insertAdjacentHTML('beforeend', toastHTML);

    const toastEl = document.getElementById(id);
    const toast = new bootstrap.Toast(toastEl, {
        delay: 3000
    });

    toast.show();

    toastEl.addEventListener('hidden.bs.toast', () => {
        toastEl.remove();
    });
}



/* ==========================
   INIT
========================== */
window.addEventListener('DOMContentLoaded', loadNav);
