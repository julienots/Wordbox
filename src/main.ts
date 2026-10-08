import './ui/style.css';
import { Game } from './game';
import { POWERS } from './sim/powers';

const canvas = document.getElementById('game') as HTMLCanvasElement;
const ui = document.getElementById('ui') as HTMLElement;
const game = new Game(canvas, ui);
void game.boot();
if (__DEBUG__) Object.assign(window, { game, __powers: POWERS });
