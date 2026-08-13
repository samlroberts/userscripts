// ==UserScript==
// @name         restoreBskyNativeVideo
// @namespace    https://github.com/samlroberts/userscripts
// @description Replace Bluesky's custom video player with the browser-native video player.
// @version      2026-08-13
// @author       You
// @match        https://bsky.app/*
// @icon         https://www.google.com/s2/favicons?sz=64&domain=bsky.app
// @updateURL    https://raw.githubusercontent.com/samlroberts/userscripts/main/restoreBskyNativeVideo.user.js
// @downloadURL  https://raw.githubusercontent.com/samlroberts/userscripts/main/restoreBskyNativeVideo.user.js
// @grant        none
// ==/UserScript==


// @source      https://github.com/bluesky-social/social-app/issues/8140

/*
	The DOM of/adjacent to the Bluesky custom video player (which lacks playback speed controls) is,
		<div $container>
			<figure $figure>
				<video></video>
				<figcaption>Alt text</figcaption>
			</figure>

			<div>
				<!-- Overlay with custom video player controls -->
			</div>
		</div>

	This script, replaces the $container with the $figure, enables native controls, and unmutes the
	video.
*/

setInterval(() => {
	for (const video of document.querySelectorAll('video:not([data-dotfiles-restore-native-video])')) {
		const figure = video.parentElement;
		if (!(figure instanceof HTMLElement && figure.tagName === 'FIGURE')) {
			return;
		}

		const container = figure.parentElement;
		if (!(container instanceof HTMLDivElement)) {
			return;
		}

		container.replaceWith(figure);

		video.controls = true;
		video.muted = false;
		video.volume = 0.5;

		video.dataset.dotfilesRestoreNativeVideo = '';
	}
}, 750);