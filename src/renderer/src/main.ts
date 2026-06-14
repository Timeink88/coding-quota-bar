import { createApp } from 'vue'
import App from './App.vue'
import i18n from './locales'
import './styles/colors.css'
import '../style.css'

createApp(App).use(i18n).mount('#app')
