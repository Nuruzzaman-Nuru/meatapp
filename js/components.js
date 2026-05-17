document.addEventListener('DOMContentLoaded', () => {
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
