# Chrome Web Store listing

## Release

- Name: No BS Summary
- Visibility: Unlisted
- Category: Productivity
- Language: English
- Privacy policy: https://no-bullshit-summary.echonad3.workers.dev/privacy
- Homepage: https://no-bullshit-summary.echonad3.workers.dev
- Support: https://github.com/echoNad3/no_bullshit_summary/issues

## Short description

Summarize the current captioned YouTube video without the padding.

## Detailed description

Get the point of a captioned YouTube video without leaving the tab.

No BS Summary opens in Chrome’s side panel, detects the YouTube video you are watching,
and returns a detailed English summary with the important facts, names, numbers, arguments, and
conclusions. It also gives a small WATCH / SKIM / SKIP verdict with one blunt reason.

How it works:

1. Open a captioned YouTube video.
2. Click the extension’s toolbar button.
3. Enter the shared app password the first time.
4. Click “Cut the BS.”

The extension has no ads, analytics, accounts, or tracking. It is an unlisted friends-only tool
and requires the shared app password from the owner.

Quality-of-life features include restoring the latest result, larger text, video thumbnails,
reading time, a backend/password check, request cancellation and retry, safe diagnostics, and an
optional lock that keeps the panel on the current video while you change tabs.

## Single purpose

Summarize the currently active captioned YouTube video in Chrome’s side panel.

## Permission justifications

- sidePanel: Shows the summary beside the YouTube video without replacing or modifying the page.
- storage: Saves the user-entered shared app password and text-size preference in Chrome Sync so
  they only need to be entered once. Saves the most recent completed summary locally on that device
  so reopening the panel does not lose what the user was reading.
- YouTube host access: Reads only the active supported YouTube tab’s URL and title so the side panel
  can detect the current video and keep it updated while the panel stays open. It does not inject
  scripts or read page content.
- no-bullshit-summary.echonad3.workers.dev host access: Sends the user-requested video URL, title,
  caption language, and app password to the production summary API over HTTPS and receives the
  result.

The extension also loads the selected video's public thumbnail from YouTube's image server. This
does not require another Chrome permission.

## Remote code

No. All executable JavaScript is included in the extension package. The extension calls a remote
JSON API for data but never downloads or executes remote code.

## Data disclosures

Declare these data types:

- Authentication information: the shared app password entered by the user.
- Web history: the URL of the active supported YouTube video.
- Website content: the title of the active supported YouTube video.

Purpose: app functionality only. The data is not sold, used for advertising, used for credit, or
transferred for unrelated purposes. The extension sends it only when the user clicks the submit
button. The password is stored in Chrome Sync; the URL/title/language are sent to the production
backend to produce the requested summary. See the hosted privacy policy for backend processors and
retention.

Certify all Chrome Web Store Limited Use statements. Do not select any unrelated data category.

## Reviewer note

This is an unlisted friends-only extension. The reviewer can inspect the full side-panel flow and
permissions without a working app password, but a successful summary request requires the shared
password stored only as a Cloudflare Worker secret. All code is public at the support/homepage
repository. There is no remote code, analytics, advertising, or user signup.

## Image files

- Screenshot: `store/screenshot-1280x800.png`
- Small promotional image: `store/small-promo-440x280.png`
- Store icon: `apps/extension/public/icons/icon-128.png` (also included in the ZIP manifest)
