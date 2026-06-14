<template>
  <div class="model-quota-card">
    <div class="model-header">{{ title }}</div>
    <div v-for="(q, i) in quotas" :key="i" class="quota-row">
      <div class="quota-top">
        <span class="quota-range">{{ formatRange(q.startAt, q.resetAt) }}</span>
        <span class="quota-percent" :class="q.color">{{ q.total === 0 ? '∞' : (q.total > 100 || q.labelParams?.boostPermille ? `${q.total - q.used}%` : `${q.total - q.used}`) }}</span>
      </div>
      <div v-if="q.total > 0 && !q.hideBar" class="progress-bar">
        <div class="progress-fill" :class="q.color" :style="{ width: q.usageRate + '%' }"></div>
      </div>
      <div class="quota-bottom">
        <span v-if="q.total === 0" class="quota-count quota-unlimited">∞ 无限制</span>
        <span v-else-if="q.used > 100 || q.total > 100" class="quota-count">{{ q.used }} / {{ q.total }}</span>
        <span v-else-if="q.labelParams?.boostPermille && Number(q.labelParams.boostPermille) > 1000" class="quota-count">总额度 {{ Math.round(Number(q.labelParams.boostPermille) / 10) }}%，已用 {{ Math.round(q.usageRate * Number(q.labelParams.boostPermille) / 1000) }}%</span>
        <span v-else class="quota-count">已用 {{ Math.round(q.usageRate) }}%</span>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import type { QuotaItem } from '../types'

defineProps<{
  title: string
  quotas: QuotaItem[]
}>()

const { t, locale } = useI18n()

function formatTime(iso: string): string {
  if (!iso) return ''
  try {
    const d = new Date(iso)
    if (isNaN(d.getTime())) return ''
    const pad = (n: number) => String(n).padStart(2, '0')
    return `${pad(d.getMonth() + 1)}/${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
  } catch { return '' }
}

function formatRange(startIso: string | undefined, endIso: string): string {
  const end = formatTime(endIso)
  if (!startIso) return end
  const start = formatTime(startIso)
  if (!start) return end
  return `${start} - ${end}`
}
</script>

<style scoped>
.model-quota-card {
  padding: 8px 10px;
  background: var(--bg-card);
  border-radius: 10px;
  box-shadow: var(--shadow-card);
  transition: background 0.2s, box-shadow 0.2s;
}

.model-quota-card:hover {
  background: var(--bg-card-hover);
  box-shadow: var(--shadow-card-hover);
}

.model-header {
  font-weight: 700;
  font-size: 13px;
  color: var(--text-heading);
  margin-bottom: 6px;
}

.quota-row {
  margin-bottom: 6px;
}

.quota-row:last-child {
  margin-bottom: 0;
}

.quota-top {
  display: flex;
  justify-content: space-between;
  align-items: baseline;
  margin-bottom: 3px;
}

.quota-range {
  font-size: 10px;
  color: var(--text-secondary);
  font-variant-numeric: tabular-nums;
}

.quota-percent {
  font-weight: 700;
  font-size: 14px;
  font-variant-numeric: tabular-nums;
  color: var(--text-primary);
}
.quota-percent.yellow { color: #a16207; }
  .quota-percent.red { color: var(--cqb-red-dark); }

.progress-bar {
  height: 5px;
  background: var(--border-subtle);
  border-radius: 3px;
  overflow: hidden;
  margin-bottom: 2px;
}

.progress-fill {
  height: 100%;
  border-radius: 3px;
  transition: width 0.5s cubic-bezier(0.4, 0, 0.2, 1);
}
  .progress-fill.green { background: linear-gradient(90deg, var(--cqb-green-light), var(--cqb-green)); }
  .progress-fill.yellow { background: linear-gradient(90deg, var(--cqb-yellow-light), var(--cqb-yellow)); }
  .progress-fill.red { background: linear-gradient(90deg, var(--cqb-red-light), var(--cqb-red)); }

.quota-bottom {
  display: flex;
  justify-content: space-between;
  align-items: baseline;
}

.quota-count {
  font-size: 10px;
  font-variant-numeric: tabular-nums;
  color: var(--text-secondary);
}

.reset-text {
  font-size: 9px;
  color: var(--text-tertiary);
}
</style>
