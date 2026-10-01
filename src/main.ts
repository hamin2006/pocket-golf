import { Game } from './game/game';

const game = new Game(document.getElementById('app')!);
if (import.meta.env.DEV) (window as unknown as { game: Game }).game = game;
