/*
 * Demo credentials, committed on purpose.
 *
 * This is a public repository, so this key is public too, and a key in git
 * history stays there even if the file is deleted later. Avichai approved
 * that on 2026-10-12 on the grounds that biga.co.il is a demo environment
 * with nothing real behind it.
 *
 * What it can still do, so the decision stays an informed one: a partner key
 * creates REAL orders through POST /api/v1/partner/orders, and an order in
 * this system emails the supplier on the product. The only other gate is the
 * partner's IP allow-list. Rotate it from the admin (Manage External Partners
 * → the yellow key → regenerate) the moment the demo stops being needed; that
 * invalidates this one instantly.
 */
window.BOOMBUY_DEMO = {
  base: 'https://biga.co.il',
  key: 'bbk_bGYmHhoYhHtwBvVJmXvuknT4j0zVruyJpmwL8NFC9jkpma2C',
};
