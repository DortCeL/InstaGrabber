<p align="center">
  <img src="icons/icon128.png" width="96" height="96" alt="InstaGrabber icon" />
</p>

<h1 align="center">InstaGrabber</h1>

<p align="center">
  One-click downloads for Instagram photos, videos, reels, carousels and stories, right inside Instagram.
</p>

<p align="center">
  <img alt="Manifest V3" src="https://img.shields.io/badge/Manifest-V3-blue" />
  <img alt="Chrome, Edge, Brave" src="https://img.shields.io/badge/Chrome%20%7C%20Edge%20%7C%20Brave-supported-success" />
  <img alt="No dependencies" src="https://img.shields.io/badge/dependencies-none-lightgrey" />
</p>

---

## Why

Sites like snapinsta make you copy a link, switch tabs, paste it, wait, and download files one at a time. InstaGrabber adds a download button directly on Instagram, so saving a post takes one click.

## Features

| Where | What you get |
| --- | --- |
| **Feed and opened posts** | A download button on the top-right corner of every post. One click saves every photo and video in the post, including all slides of a carousel. |
| **Profile, explore and "more posts" grids** | A small download button appears when you hover over a thumbnail, so you can save a post without opening it. |
| **Post, reel and story pages** | A floating **Download** button in the bottom-right corner. |
| **Keyboard** | `Alt+Shift+D` downloads whatever is on screen: the open post, reel or story, or the feed post you are looking at. |
| **Right-click menu** | Right-click any Instagram post or reel link and choose **Download Instagram media**. |
| **Toolbar popup** | Paste any post, reel or story link and download it, even if Instagram isn't open in the current tab. |
| **Bulk download** | Open a profile, scroll to load the posts you want, then click **Download all loaded posts** in the popup. Progress is shown on the page and can be cancelled at any time. |

Other details:

- **Full resolution.** It always picks the largest image and highest-quality video Instagram offers.
- **Stories and highlights.** It downloads the story currently on screen. Highlights don't include the current item in the URL, so InstaGrabber matches the on-screen image instead. If it can't tell which item you're viewing, it asks before downloading the whole highlight.
- **Organised filenames.** Files are saved as `Downloads/Instagram/<username>/<username>_<date>_<code>_<n>.jpg|mp4`. The per-account folder can be turned off in Settings.
- **Visual feedback.** Buttons show a spinner while working and a check mark when done, and a small message appears at the bottom of the page.

## Install

InstaGrabber isn't on an extension store yet, so you load it from source. This takes about a minute.

1. Download this repository (**Code**, then **Download ZIP**) and unzip it, or clone it:
   ```bash
   git clone https://github.com/DortCeL/InstaGrabber.git
   ```
2. Open your browser's extensions page:
   - Chrome: `chrome://extensions`
   - Edge: `edge://extensions`
   - Brave: `brave://extensions`
3. Turn on **Developer mode**.
4. Click **Load unpacked** and select the `InstaGrabber` folder (the one containing `manifest.json`).
5. Pin the extension (puzzle-piece icon, then the pin) so the popup is one click away.
6. Refresh any Instagram tabs that were already open.

You must be logged in to instagram.com in the same browser.

### Brave users: stop the "Save as" dialog for every file

Brave turns on **"Ask where to save each file before downloading"** by default, and that browser setting overrides extensions. To download without a dialog for each file, open `brave://settings/downloads` and switch it off. Chrome and Edge have the same setting under Downloads.

## How it works

1. When you click download, InstaGrabber reads the post's short code from its link (for example `/p/C9xYz.../`) and converts it to Instagram's numeric media ID.
2. It asks Instagram's web API for that post's details, using the same endpoint and headers the Instagram website itself uses. The request is sent from the Instagram page you have open, with your normal login.
3. From the response, it picks the highest-resolution version of every photo and video.
4. It hands the file links to the browser's download manager, which saves them with tidy filenames.

Each post normally needs **one** request to Instagram's API (stories need two: one to find the account, one to list its stories). The photo and video files are then fetched from Instagram's image servers (its CDN), the same servers your browser loads images from while you scroll.

## Pacing and delays (bulk download)

Single downloads aren't delayed, because they happen at the speed you click, which already looks like normal browsing. Bulk downloads are where an account could get flagged, so they're deliberately slowed down and made irregular:

| Delay | Value | Why |
| --- | --- | --- |
| Between posts | Random, **2 to 5 seconds** | Keeps the request rate low, and avoids the perfectly regular rhythm that is a typical sign of a bot. |
| Longer break | Random **30 to 60 seconds**, after every random **20 to 30 posts** | Breaks up long runs, so a big batch doesn't look like nonstop automated activity. The page shows a countdown. |
| Between photos of the same post | None | Photos come from Instagram's image servers, not its API, so spacing them out wouldn't reduce risk. |

At these settings, 100 posts take roughly 7 to 9 minutes.

## Cautions and safety measures

**Protecting your account**

- **Read-only.** InstaGrabber only *reads* posts and stories that you can already see on Instagram. It never likes, follows, comments, sends messages or changes anything on your account. Automating those actions is what usually gets accounts banned.
- **Uses Instagram's own traffic pattern.** Requests are sent from inside your open Instagram tab, with the same endpoint and headers the website uses, rather than from a separate server.
- **Stops automatically on rate limits.** If Instagram responds with "too many requests" (HTTP 429), the bulk download stops immediately and tells you, instead of retrying and making things worse.
- **No wasted requests.** If the main lookup is rate-limited, InstaGrabber doesn't fire its backup lookup.
- **Cancel any time.** The bulk progress message has a Cancel button that takes effect immediately, even during a break.

**Your privacy**

- **No servers, no tracking, no analytics.** Everything runs in your browser. Nothing is sent anywhere except to Instagram itself.
- **Your login never leaves the browser.** InstaGrabber doesn't read, store or transmit your password or session.
- **Minimal settings storage.** Only your two preferences (per-account folders and "ask where to save") are stored, using the browser's built-in extension storage.

**Permissions and why they're needed**

| Permission | Used for |
| --- | --- |
| `downloads` | Saving files with organised names and folders. |
| `storage` | Remembering your two settings. |
| `contextMenus` | The right-click **Download Instagram media** option. |
| `scripting` | Adding the download buttons to Instagram tabs that were open before the extension was installed or updated. |
| `https://*.instagram.com/*` | Adding buttons to Instagram pages and reading post details. |

**Honest limits**

- **There is still some risk.** Instagram's terms prohibit automated data collection. Normal one-click use is very unlikely to cause problems, but heavy bulk downloading on your main account can lead to temporary "try again later" blocks or a login check. For large archives, consider a secondary account.
- **It can break when Instagram changes.** InstaGrabber relies on Instagram's private web API, which can change without notice. All media lookups live in `lib/instagram.js`, so fixes are usually small.
- **Respect creators.** Only download content you have the right to save, and don't re-upload other people's work without permission.

## Troubleshooting

| Problem | Fix |
| --- | --- |
| "Instagram refused the request" | Log in to instagram.com in this browser, then try again. |
| No buttons on Instagram | Refresh the Instagram tab. After reloading or updating the extension, open Instagram tabs need a refresh. |
| A "Save as" dialog for every file | Turn off "Ask where to save each file" in the browser's download settings (see the Brave section above), and in InstaGrabber's Settings. |
| `Alt+Shift+D` does nothing | Another extension may use the same shortcut. Change it at `chrome://extensions/shortcuts`. |
| "Instagram is rate-limiting you" | Stop for a few minutes before downloading again. |

## Project structure

```
InstaGrabber/
├── manifest.json        Extension manifest (Manifest V3)
├── background.js        Downloads, right-click menu, keyboard shortcut
├── content.js           Buttons, bulk download and messages on instagram.com
├── content.css          Styles for the buttons and messages
├── popup.html/.css/.js  Toolbar popup (paste a link, bulk download, settings)
├── lib/
│   └── instagram.js     Link parsing, Instagram API calls, filenames (shared)
├── icons/               Extension icons
└── scripts/
    └── make-icons.js    Regenerates the icons with plain Node.js
```

There is no build step and there are no dependencies. Edit the files, then click the reload icon on the extension's card at `chrome://extensions`. To regenerate the icons, run `node scripts/make-icons.js`.

## Disclaimer

InstaGrabber is an independent project. It is not affiliated with, endorsed by or sponsored by Instagram or Meta Platforms, Inc. "Instagram" is a trademark of Meta Platforms, Inc. Use this extension responsibly and at your own risk.

## Built with AI

I built this project with **[Cursor](https://cursor.com)**, an AI-powered code editor. I described what I wanted, and Cursor's AI agent wrote the code and helped me test and refine it: the download buttons, Instagram API handling, bulk download pacing, popup and this README. I reviewed the changes, tested them in my browser, and decided on the features and safety measures.
