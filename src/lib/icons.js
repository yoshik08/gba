// Phosphor icons (MIT), imported as raw SVG so they are inlined and tree-shaken.
import play from '@phosphor-icons/core/assets/fill/play-fill.svg?raw';
import search from '@phosphor-icons/core/assets/regular/magnifying-glass.svg?raw';
import back from '@phosphor-icons/core/assets/regular/arrow-left.svg?raw';
import more from '@phosphor-icons/core/assets/bold/dots-three-bold.svg?raw';
import help from '@phosphor-icons/core/assets/regular/question.svg?raw';
import ff from '@phosphor-icons/core/assets/fill/fast-forward-fill.svg?raw';
import save from '@phosphor-icons/core/assets/regular/floppy-disk.svg?raw';
import saveFill from '@phosphor-icons/core/assets/fill/floppy-disk-fill.svg?raw';
import close from '@phosphor-icons/core/assets/regular/x.svg?raw';
import check from '@phosphor-icons/core/assets/bold/check-bold.svg?raw';
import cloud from '@phosphor-icons/core/assets/regular/cloud.svg?raw';
import cloudCheck from '@phosphor-icons/core/assets/regular/cloud-check.svg?raw';
import cloudSlash from '@phosphor-icons/core/assets/regular/cloud-slash.svg?raw';
import cloudUp from '@phosphor-icons/core/assets/regular/cloud-arrow-up.svg?raw';
import download from '@phosphor-icons/core/assets/regular/download-simple.svg?raw';
import downloaded from '@phosphor-icons/core/assets/fill/check-circle-fill.svg?raw';
import trash from '@phosphor-icons/core/assets/regular/trash.svg?raw';
import drive from '@phosphor-icons/core/assets/regular/google-drive-logo.svg?raw';
import google from '@phosphor-icons/core/assets/bold/google-logo-bold.svg?raw';
import controller from '@phosphor-icons/core/assets/regular/game-controller.svg?raw';
import keyboard from '@phosphor-icons/core/assets/regular/keyboard.svg?raw';
import hand from '@phosphor-icons/core/assets/regular/hand-tap.svg?raw';
import speaker from '@phosphor-icons/core/assets/regular/speaker-high.svg?raw';
import speakerX from '@phosphor-icons/core/assets/regular/speaker-x.svg?raw';
import vibrate from '@phosphor-icons/core/assets/regular/vibrate.svg?raw';
import signOut from '@phosphor-icons/core/assets/regular/sign-out.svg?raw';
import clock from '@phosphor-icons/core/assets/regular/clock-counter-clockwise.svg?raw';
import refresh from '@phosphor-icons/core/assets/regular/arrows-clockwise.svg?raw';
import warn from '@phosphor-icons/core/assets/fill/warning-circle-fill.svg?raw';
import code from '@phosphor-icons/core/assets/regular/code.svg?raw';
import eye from '@phosphor-icons/core/assets/regular/eye.svg?raw';
import eyeSlash from '@phosphor-icons/core/assets/regular/eye-slash.svg?raw';
import pause from '@phosphor-icons/core/assets/fill/pause-fill.svg?raw';
import wifiSlash from '@phosphor-icons/core/assets/regular/wifi-slash.svg?raw';
import stack from '@phosphor-icons/core/assets/regular/stack.svg?raw';
import caretRight from '@phosphor-icons/core/assets/bold/caret-right-bold.svg?raw';
import install from '@phosphor-icons/core/assets/regular/arrow-square-down.svg?raw';

const ICONS = { play, search, back, more, help, ff, save, saveFill, close, check, cloud, cloudCheck, cloudSlash, cloudUp, download, downloaded, trash, drive, google, controller, keyboard, hand, speaker, speakerX, vibrate, signOut, clock, refresh, warn, code, eye, eyeSlash, pause, wifiSlash, stack, caretRight, install };

export function icon(name, cls = '') {
  return `<span class="icon ${cls}" aria-hidden="true">${ICONS[name] || ''}</span>`;
}
