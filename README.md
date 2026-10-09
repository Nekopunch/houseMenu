# The House Menu — v2

Mobile-first cookbook hosted on GitHub Pages, with recipes and checklist state stored in Google Sheets and photos in Google Drive.

## Files
- `index.html` — page structure
- `styles.css` — design
- `app.js` — frontend logic, ingredient sections, sync
- `config.js` — Apps Script URL and shared secret
- `Code.gs` — Google Apps Script backend (DO NOT upload this file to GitHub)

## Setup
1. Create a new Google Spreadsheet named `The House Menu`.
2. Open **Extensions → Apps Script**.
3. Replace the contents of `Code.gs` with the supplied `Code.gs` and save.
4. In Apps Script, run `setupCookbook` once. Approve Google permissions. It creates the `Recipes` tab and `House Menu Photos` folder in your Drive.
5. In **Project Settings → Script properties**, add `APP_SECRET` with a long random string (for example, 40+ random characters).
6. **Deploy → New deployment → Web app**. Execute as **Me**, access **Anyone**. Authorize and copy the `/exec` URL.
7. Paste the URL and the same secret into `config.js`.
8. Upload `index.html`, `styles.css`, `app.js`, `config.js` to your GitHub Pages repo. Enable Pages under **Settings → Pages**.
9. Open the published website, add a test recipe on your computer, and check it on your phone.

**When you edit Apps Script later:** use **Deploy → Manage deployments → Edit → New version → Deploy**. Editing the script alone does not update the live `/exec` deployment.

## Important privacy/security warning
A GitHub Pages site is public, and any `SECRET` placed in `config.js` can be read by anyone who visits it. This shared-secret design is convenient for a personal prototype, **not secure authentication**. Anyone who gets your site URL can inspect the secret and read/change/delete recipes through the Apps Script endpoint. Do not put sensitive information in recipes, and do not treat the Sheet or Drive photo URLs as private. Photos are set to **Anyone with the link can view** to display them in the app.

For a genuinely private production app, replace this shared-secret/public web-app approach with Google account authentication and server-side access controls, or a managed backend with real user authentication (such as Firebase Auth + Firestore/Storage). Simply making the GitHub repository private does not secure a published GitHub Pages site.

## Behavior and limitations
- Ingredient sections: first is always `Main`; add/remove titled extra sections.
- Checkbox state syncs via Sheets; tap **Uncheck all** to reset a recipe.
- Photos are compressed on the phone before upload.
- The app verifies saves by re-reading the Sheet, because cross-origin Apps Script POST responses are not readable reliably in the browser.
- Edits to ingredients preserve checkmarks by position. After changing section order/ingredients, use **Uncheck all** to reset.
- The **Export** button downloads recipe text/data with photo URLs, not embedded image files. No bulk import in v2.
- Updates from another device appear when you press **Refresh** or return to the browser tab. There is no live push sync.
- Avoid editing the same recipe simultaneously on two devices; last write wins.
- This version starts with a new cloud database; it does not automatically migrate recipes from the old IndexedDB-only version.
