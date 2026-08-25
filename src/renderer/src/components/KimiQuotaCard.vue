<template>
  <div class="quota-card">
    <div class="card-top">
      <span class="quota-label">{{ $t(label, labelParams ?? {}) }}</span>
      <span class="quota-percent" :class="color">{{ animatedPercent.formatted.value }}%</span>
    </div>
    <div class="progress-bar">
      <div class="progress-fill" :style="progressStyle"></div>
    </div>
    <div class="card-bottom">
      <span class="used-text">{{ $t('quota.usedCount', { used, total }) }}</span>
      <span class="reset-text" :title="resetAbsolute">{{ resetCountdown }}</span>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { useAnimatedNumber } from '../composables/useAnimatedNumber'

const props = defineProps<{
  label: string
  labelParams?: Record<string, string | number>
  used: number
  total: number
  usageRate: number
  resetAt: string
  color: 'green' | 'yellow' | 'red'
}>()

const { t, locale } = useI18n()

// 百分比平滑过渡（与 QuotaCard 一致）
const animatedPercent = useAnimatedNumber(() => props.usageRate, { duration: 500, decimals: 0 })

/**
 * HSL 渐变进度条（与 QuotaCard 一致）：0% 绿 → 50% 黄 → 100% 红
 */
const progressStyle = computed(() => {
  const rate = Math.max(0, Math.min(100, animatedPercent.value.value))
  const hue = 142 - (rate / 100) * 142
  const sat = 70
  const light = 60 - (rate / 100) * 5
  return {
    width: `${rate}%`,
    background: `linear-gradient(90deg, hsl(${hue}, ${sat}%, ${light + 8}%), hsl(${hue}, ${sat}%, ${light}%))`,
  }
})

// 倒计时每分钟刷新一次
const now = ref(Date.now())
let timer: ReturnType<typeof setInterval> | null = null
onMounted(() => {
  if (timer === null) timer = setInterval(() => { now.value = Date.now() }, 60000)
})
onUnmounted(() => {
  if (timer !== null) { clearInterval(timer); timer = null }
})

/**
 * 重置倒计时：复用 overview 的 resetIn* 文案
 * 已到期显示绝对时间（数据等待下次刷新）
 */
const resetCountdown = computed(() => {
  if (!props.resetAt) return ''
  const target = new Date(props.resetAt).getTime()
  if (isNaN(target)) return ''
  const diffMin = Math.ceil((target - now.value) / 60000)
  if (diffMin <= 0) return resetAbsolute.value
  if (diffMin < 60) return t('overview.resetInMinutes', { n: diffMin })
  const hours = Math.floor(diffMin / 60)
  const mins = diffMin % 60
  if (hours < 24) return t('overview.resetInHoursMinutes', { h: hours, m: mins })
  const days = Math.floor(hours / 24)
  const remainHours = hours % 24
  if (days < 7) return t('overview.resetInDaysHours', { d: days, h: remainHours })
  return t('overview.resetInDays', { n: days })
})

const resetAbsolute = computed(() => {
  if (!props.resetAt) return ''
  try {
    const d = new Date(props.resetAt)
    if (isNaN(d.getTime())) return ''
    return d.toLocaleString(locale.value, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false })
  } catch { return '' }
})
</script>

<style scoped>
.quota-card {
  padding: 8px 10px;
  background: var(--bg-card);
  border-radius: 8px;
  box-shadow: var(--shadow-card);
  transition: background 0.2s, box-shadow 0.2s;
}

.quota-card:hover {
  background: var(--bg-card-hover);
  box-shadow: var(--shadow-card-hover);
}

.card-top {
  display: flex;
  justify-content: space-between;
  align-items: baseline;
  margin-bottom: 5px;
}

.quota-label {
  font-weight: 600;
  font-size: 13px;
  color: var(--text-heading);
}

.quota-percent {
  font-weight: 700;
  font-size: 16px;
  font-variant-numeric: tabular-nums;
  color: var(--text-primary);
  transition: color 0.3s;
}
.quota-percent.yellow { color: var(--cqb-yellow-dark); }
.quota-percent.red    { color: var(--cqb-red-dark); }

.progress-bar {
  height: 6px;
  background: var(--border-subtle);
  border-radius: 3px;
  overflow: hidden;
  margin-bottom: 5px;
}

.progress-fill {
  height: 100%;
  border-radius: 3px;
  transition: width 0.5s cubic-bezier(0.4, 0, 0.2, 1);
}

.card-bottom {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 6px;
  min-height: 14px;
}

.used-text {
  font-size: 10px;
  color: var(--text-secondary);
  font-variant-numeric: tabular-nums;
}

.reset-text {
  font-size: 10px;
  color: var(--text-tertiary);
}
</style>
