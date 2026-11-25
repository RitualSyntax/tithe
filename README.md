# Tithe

Invoices, expenses and a running tax estimate for self-employed work. It's a PWA, like Forge. Everything is stored on your phone, and there's no server apart from the optional Google mail script.

## Put it online

1. Make a new GitHub repo, e.g. `RitualSyntax/tithe`.
2. Upload everything in this folder (the `mail-script` folder can stay out if you like).
3. In the repo, go to Settings → Pages → Deploy from branch → `main` / root.
4. Open the Pages URL in Chrome on your phone, then use the menu → **Add to Home screen**.
5. Open the app, tap the gear and fill in your details and bank info.

## Make "Complete & send" actually email the invoice

(The same script also lets Grimoire import recipes from links.)

The app can't send email by itself, so it uses a small Google Apps Script running on your own Gmail. It's free and sends from your address, and sent invoices show up in your Gmail Sent folder.

1. Go to https://script.google.com → **New project**.
2. Delete what's there and paste in `mail-script/Code.gs`.
3. Change `TOKEN` at the top to a long random string.
4. Pick `authorise` from the function dropdown → **Run** → allow Gmail access. (Google shows an "unverified app" warning because it's your own script. Click Advanced → Go to project.)
5. Click **Deploy → New deployment** → type **Web app**:
   - Execute as: **Me**
   - Who has access: **Anyone** (the token is what keeps other people out)
6. Copy the web app URL (it starts `https://script.google.com/macros/s/...`).
7. In Tithe settings, paste the URL and the same token, then tap **Test mail script**.

Gmail lets a personal account send roughly 100 emails a day from a script, which is plenty.

If you edit the script later, use **Deploy → Manage deployments → Edit → New version**, or the URL keeps running the old code.

If you don't set up a script, **Complete & send** opens the Android share sheet with the PDF attached instead, and the client's email is copied so you can paste it in.

## How things work

- **Invoice numbers** count up automatically (`INV-0001`...). Change the prefix in settings, e.g. `RS-`.
- **Receipt scanning** reads the photo on the phone (Tesseract) and fills in the total, VAT, date, supplier and a guessed category. Always check what it fills in. It needs a connection the first time it loads the reader.
- **Mileage** is claimed at 45p a mile, dropping to 25p after 10,000 miles in a tax year. If you claim mileage, you can't also claim fuel or other car costs.
- **Tax** follows the 2026/27 rates for England, Wales and NI. The rates are in the `R` object at the top of `app.js`, so check them each April.
  - Income counts when it's paid (cash basis) unless you switch it in settings.
  - Put your PAYE salary for the year in "Other taxable income" so the estimate knows your tax-free allowance is already used up.
  - The £1,000 trading allowance is used automatically when it beats your real expenses.
  - The estimate doesn't cover student loans, pension relief, Scottish rates or anything clever, so check with HMRC or an accountant before you file.
- **CSV export** on the Tax tab lists every income and expense line with the Self Assessment box it belongs in.
- **Backups**: the data only lives on the phone. Export a backup from settings every so often, especially before changing phones or clearing Chrome data.

## Making Tax Digital

Sole traders with income over £30k (from April 2027) or £20k (from April 2028) have to send quarterly updates through MTD-compatible software. HMRC checks your income from two tax years earlier. Tithe can't submit to HMRC, but its CSV export can be imported into the free MTD bridging tools.
