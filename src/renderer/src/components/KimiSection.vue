<template>
  <div v-for="q in sortedQuotas" :key="q.limitType ?? q.label" class="quota-row-single">
    <KimiQuotaCard
      :label="q.label"
      :label-params="q.labelParams"
      :usage-rate="q.usageRate"
      :reset-at="q.resetAt"
      :color="q.color ?? 'green'"
    />
  </div>
  <div v-if="account.parallelLimit != null" class="parallel-line">
    {{ $t('quota.kimiParallel', { n: account.parallelLimit }) }}
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import KimiQuotaCard from './KimiQuotaCard.vue'
import type { AccountUsageData, QuotaItem } from '../types'

const props = defineProps<{
  account: AccountUsageData
}>()

const sortedQuotas = computed<QuotaItem[]>(() => {
  // 顺序：5h 窗口 → 周额度 → 月额度 → 其他（与智谱/OpenCode 的短周期在前一致）
  const order = ['kimi-5h', 'kimi', 'kimi-monthly']
  return [...(props.account.quotas ?? [])].sort((a, b) => {
    const ai = order.indexOf(a.limitType ?? '')
    const bi = order.indexOf(b.limitType ?? '')
    return (ai === -1 ? 999 : ai) - (bi === -1 ? 999 : bi)
  })
})
</script>

<style scoped>
.quota-row-single {
  margin-bottom: 6px;
}

.parallel-line {
  font-size: 10px;
  color: var(--text-tertiary);
  text-align: right;
  padding-right: 2px;
}
</style>
