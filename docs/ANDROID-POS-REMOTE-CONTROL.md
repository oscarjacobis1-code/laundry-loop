# Remote-controlled Laundry Loop Android POS (v2.3)

This APK adds a **native**, reversible access gate independent of the POS WebView and its offline cache.

## Operator control (SnapNest only)

Use the existing Laundry Loop project in **Netlify**:
1. Project configuration → Environment variables.
2. Set **key** `LAUNDRY_SERVICE_SUSPENDED` to **value** `true`.
3. Redeploy the production site. The public website, staff portal and admin portal display the already-established neutral suspension screens. The native Android gate checks `GET https://thelaundryloop.net/api/pos-access`.
4. To restore service, set the value to `false` and redeploy. The APK checks again automatically within ~60 seconds while open, or press **Check again**.

There is no administrator password or private token embedded in the APK. The value is managed outside the suspended website in the Netlify account.

## What staff see
- Suspension: **Service Temporarily Suspended** — **Please contact administrator for more information.**
- Temporary lack of verification (e.g., first launch with no internet, or an expired offline lease): **Connection Required** — **Connect to the internet to verify POS access. Saved orders remain on this tablet.**
- No development charges, hosting bills, fees, or dispute details are shown.

## Offline access and safeguards
- A **confirmed suspension** remains in effect across restarts and offline periods until the device obtains a confirmed active response.
- When active has been verified online, the APK allows up to **24 hours of offline operation**. If it cannot recheck after this period, it blocks POS operation pending reconnection.
- Checks run on a background thread every 60 seconds while the APK is foregrounded and on every app resume; HTTPS requests bypass the WebView service worker.
- The native overlay blocks touches and native print commands. It does not erase the APK, WebView storage, local offline orders, cached services, receipts, or customer information.
- Existing open sessions on **older APK versions** are not affected by this new native feature. The upgraded APK **must be installed on the client tablet** before native suspension can work.
- Server/API access outside the new APK (e.g., an old application or direct Supabase calls) is outside this feature. It is not equivalent to revoking every user session at the backend.
- A device with no internet cannot receive an immediate remote change. The 24-hour grace window deliberately balances resilience and suspension enforcement.
- The app requires at least one online verification before the *new* controlled build can run offline.

## Build and delivery
GitHub Actions workflow `Android POS controlled APK` assembles `app-debug.apk` and uploads it as an artifact named `laundry-loop-pos-2.3-remote-control-debug` for commissioning. If signing secrets are available, it also builds a release APK.

**Important for updating the installed APK:** Android requires the **same package name and signing certificate** for an in-place update. The package remains `com.laundryloop.printbridge`, but a GitHub-generated debug APK may use a different debug certificate from the currently installed APK. A mismatched signature cannot update in place. Do **not uninstall the existing app** to force an install: that could erase unsynced local orders and offline credentials. Verify signing and back up/sync queued orders before installation.

## Verification checklist
1. Build the APK with the Android CI workflow.
2. Verify it installs **as an update** on a controlled test tablet with the proper signing key.
3. With flag `false`, confirm staff sign-in, online and offline order creation, printing and cash drawer work normally.
4. With flag `true`, confirm Android app shows neutral suspension within one minute, and printing is blocked.
5. Turn internet off, restart the APK and confirm the suspension persists.
6. With flag back to `false`, confirm the APK restores access on reconnect with **Check again**.
7. Check that saved offline orders and staff credentials remain available and synchronize correctly after restoration.
8. Test expiry behavior after the 24-hour lease in a safe test environment before deploying to production.

Do not add secret admin access to the client's app, and do not activate suspension while staff are processing unsynced transactions unless contractually authorized and operationally safe.
