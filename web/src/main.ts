import './style.css';
import { GameApplication } from './app/GameApplication';

const root = document.querySelector<HTMLElement>('#app');
if (!root) throw new Error('Missing application root');
const application = new GameApplication(root);
if (import.meta.hot) import.meta.hot.dispose(() => application.destroy());
