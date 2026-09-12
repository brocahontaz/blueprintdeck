import './style.css';
import { mountBlueprintDeck } from './ui/app';

const root = document.getElementById('app');
if (root) {
  mountBlueprintDeck(root);
} else {
  document.body.textContent = 'BlueprintDeck failed to mount: missing #app element.';
}
