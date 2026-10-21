# Google Drive backup (Save / Load buttons)

PokéGo can keep a copy of each player's save in **their own Google Drive**:
**Settings → Account → Google Drive → Save to Google Drive / Load from Google Drive**.
Nothing syncs on its own; the game only talks to Google when one of those buttons is pressed.

The file backup (**Download save / Import save**) works without any of this. Google Drive
needs a free OAuth client from Google Cloud, which takes about 10 minutes to set up. Until
`G.GOOGLE_CLIENT_ID` is set, the Drive buttons are hidden and the Account tab shows a short
hint pointing here.

## What it does

- **Permission:** Google Identity Services opens a Google window and asks for the
  `https://www.googleapis.com/auth/drive.file` scope. With that scope the game can only see
  files that **it created itself**. It cannot see anything else in the player's Drive.
- **File:** the save goes to a folder called **PokéGo** in My Drive, as `pokego-<account name>.json`.
  The player can see it, download it and delete it like any other file. The game finds
  the file by hidden app properties, so moving or renaming it is fine.
- **Save to Google Drive:** downloads the copy already in Drive (if there is one), merges it with
  the save on this device (nothing earned is lost: collections are combined, and coins and
  tickets go through the save's ledger), uploads the result and keeps it on this device too.
- **Load from Google Drive:** downloads the copy and, after an in-game confirmation, imports it
  in the same way as an imported file.
- The access token lasts about one hour and stays in memory only. When it expires, the next
  press opens the Google window again.
- Neither the game nor its author receives the file: the browser sends it straight to Google.

## 1. Create a Google Cloud project

1. Go to <https://console.cloud.google.com/> and sign in with your Google account.
2. Click the **project picker** at the top of the page (next to the "Google Cloud" logo), then
   click **New project**.
3. **Project name:** `PokeGo` (any name works). Leave **Location** as it is and click **Create**.
4. When the notification says the project is ready, click **Select project** (or pick it in the
   project picker). Check that the project picker now shows `PokeGo`.

## 2. Enable the Google Drive API

1. Open the **☰** menu (top left) → **APIs & Services** → **Library**.
2. In the search box type `Google Drive API` and click the **Google Drive API** result.
3. Click **Enable**. (Direct link: <https://console.cloud.google.com/apis/library/drive.googleapis.com>)

## 3. OAuth consent screen (External, Testing, test users)

1. **☰** → **APIs & Services** → **OAuth consent screen**. This opens **Google Auth Platform**.
   If it says that Google Auth Platform is not configured yet, click **Get started**.
2. **App Information:** App name `PokéGo`. For **User support email**, choose your Gmail. Click **Next**.
3. **Audience:** choose **External**, then click **Next**.
4. **Contact Information:** type your email address. Click **Next**.
5. **Finish:** tick *I agree to the Google API Services: User Data Policy*, click **Continue**,
   then click **Create**.
6. In the left menu, click **Audience**:
   - **Publishing status** must say **Testing**. Leave it like that.
   - Under **Test users**, click **+ Add users**. Type the Gmail addresses that may use the
     Drive buttons (yours, and your friends' if you like; up to 100), then click **Save**.
     While the app is in Testing, **only these accounts** can sign in.
7. In the left menu, click **Data Access**:
   - Click **Add or remove scopes**.
   - Under **Manually add scopes**, paste `https://www.googleapis.com/auth/drive.file` and
     click **Add to table**. (Or type `drive.file` in the filter and tick
     `.../auth/drive.file`, "See, edit, create, and delete only the specific Google Drive files
     you use with this app".)
   - Click **Update**, then click **Save** at the bottom of the page. The scope appears under
     **Your non-sensitive scopes**.

> In Testing mode Google makes test users approve again after **7 days**. When that happens,
> the game shows the Google window again on the next press. Approve it and carry on.

## 4. Create the OAuth client ID (Web application)

1. In the left menu of Google Auth Platform, click **Clients** → **+ Create client**.
   (The same page is also at **☰** → **APIs & Services** → **Credentials** → **+ Create
   credentials** → **OAuth client ID**.)
2. **Application type:** **Web application**.
3. **Name:** `PokéGo web`.
4. Under **Authorized JavaScript origins**, click **+ Add URI** once for each of these:
   - `http://localhost:8123`
   - `http://127.0.0.1:8123`
   - `https://<github-username>.github.io` (replace `<github-username>` with your GitHub user
     name, for example `https://ash-ketchum.github.io`)

   Origins are only the scheme, host and port. Do not add a path or a trailing `/`, even if
   the game lives at `https://<github-username>.github.io/PokeGo/`. `localhost` and
   `127.0.0.1` count as different origins, and so does every port. If you later publish on
   your own domain, add it here too (for example `https://pokego.example`).
5. Leave **Authorized redirect URIs** empty and click **Create**.
6. The **OAuth client created** dialog shows the **Client ID**, which ends in
   `.apps.googleusercontent.com`. Copy it. The game does **not** need the client secret.
   Never put the secret in the game's files.

New origins can take from 5 minutes to a few hours to start working.

## 5. Put the client ID in the game and rebuild

1. Open [`js/core/google-config.js`](../js/core/google-config.js) and replace
   `G.GOOGLE_CLIENT_ID = null;` with your ID:

   ```js
   G.GOOGLE_CLIENT_ID = '1234567890-abcdefghijklmnop.apps.googleusercontent.com';
   ```

   The client ID is not a secret: like the Firebase config, it is meant to be in the web page.
   Google only accepts it from the origins you listed in step 4.
2. Rebuild (from the project folder):

   ```
   node tools/build.js && node tools/export_data.js && python tools/make_seo_pages.py
   ```

3. Start the local server, `python -m http.server 8123`, and open <http://localhost:8123>
   (or `/dev.html` for the unminified code).

No other change is needed. `dev.html` already allows the Google Identity Services script
(`https://accounts.google.com` in its Content-Security-Policy). The Drive API calls and the
Google window are not restricted by it.

## 6. Try it

1. Log in to a game account (or create one). Guests can only download a file.
2. Go to **Settings → Account → Google Drive** and click **Save to Google Drive**.
3. In the Google window, choose one of the **test users**. Google warns that it **hasn't
   verified this app**. That is expected for your own app in Testing: click **Continue**.
4. Allow access to *the specific Google Drive files you use with this app*.
5. The game says the game was saved. In <https://drive.google.com> you'll find
   **My Drive → PokéGo → pokego-<name>.json**, and the Account tab shows **Last copy in Drive**.
6. On another browser or device, log in to an account with the **same name** and click
   **Load from Google Drive**.

## Troubleshooting

| What you see | Why / what to do |
| --- | --- |
| Google window: **Error 400: origin_mismatch** (or `redirect_uri_mismatch`) | The page's origin is not in **Authorized JavaScript origins** (step 4). Check http vs https, `localhost` vs `127.0.0.1` and the port. Wait a few minutes after adding it. |
| Google window: **Access blocked … has not completed the Google verification process** / **Error 403: access_denied** | That Google account is not a **test user** (step 3.6). |
| Game: *The browser blocked the Google window* | Allow pop-ups for the site. Ad blockers sometimes block `accounts.google.com`. |
| Game: *Could not connect to Google…* | The Google Identity script could not load (offline, or blocked by an ad blocker or extension). |
| Game: *Google Drive rejected the request* | The **Google Drive API** is not enabled in this project (step 2), or it was enabled only a minute ago. The browser console (F12) shows Google's reason. |
| Game: *PokéGo needs your permission…* | The Drive box was unticked in the Google window. Press the button again and allow it. |
| Game: *Google Drive only works when the game is opened from a website…* | The game was opened by double-clicking `index.html` (`file://`). Use the local server or the published site. |
| Game: *Your Google session has expired…* | The one-hour token expired. Press the button again. |

To remove the game's access, go to <https://myaccount.google.com/permissions>, choose **PokéGo**
and click **Delete all connections**. The file stays in Drive until you delete it.

## Leaving Testing mode (optional)

While the app is in **Testing**, only the test users can use it and they must approve again every
7 days. To let anyone use it, go to Google Auth Platform → **Audience** → **Publish app**. Apps
that only request non-sensitive scopes such as `drive.file` don't need Google's security review.
Google may still ask you to verify the app's branding (name, logo, home page and privacy
policy links) under **Branding** / **Verification Center** before it removes the "unverified
app" warning.
