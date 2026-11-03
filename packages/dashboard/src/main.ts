import { mount } from 'svelte';
import './app.css';
import App from './App.svelte';
import { applyTheme } from './lib/state.svelte';

// Apply the stored theme before the first render to avoid a flash.
applyTheme();

mount(App, { target: document.getElementById('app')! });
