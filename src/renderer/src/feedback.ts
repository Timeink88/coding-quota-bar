import { createApp } from 'vue'
import FeedbackView from './views/FeedbackView.vue'
import i18n from './locales'
import '../style.css'

const app = createApp(FeedbackView)
app.use(i18n)

// 从主进程获取语言设置
window.electronAPI.getConfig().then(config => {
  const lang = config?.language
  if (lang === 'en-US' || lang === 'zh-CN') {
    i18n.global.locale.value = lang
  }
})

app.mount('#app')
