<template>
  <div v-for="q in account.quotas" :key="q.limitType ?? q.label" class="quota-row-single">
    <QuotaCard
      v-if="!q.hideBar"
      :label="q.label"
      :label-params="q.labelParams"
      :usage-rate="q.usageRate"
      :reset-at="q.resetAt"
      :color="q.color ?? 'green'"
    />
    <div v-else class="balance-card">
      <span class="balance-label">{{ $t(q.label, q.labelParams ?? {}) }}</span>
      <span class="balance-value">{{ q.labelParams?.amount }}</span>
    </div>
  </div>
</template>

<script setup lang="ts">
import QuotaCard from './QuotaCard.vue'
import type { AccountUsageData } from '../types'

defineProps<{
  account: AccountUsageData
}>()
</script>

<style scoped>
.quota-row-single {
  margin-bottom: 6px;
}

.balance-card {
  display: flex;
  justify-content: space-between;
  align-items: baseline;
  padding: 8px 10px;
  background: var(--bg-card);
  border-radius: 8px;
  box-shadow: var(--shadow-card);
  transition: background 0.2s, box-shadow 0.2s;
}

.balance-card:hover {
  background: var(--bg-card-hover);
  box-shadow: var(--shadow-card-hover);
}

.balance-label {
  font-weight: 600;
  font-size: 13px;
  color: var(--text-heading);
}

.balance-value {
  font-weight: 700;
  font-size: 14px;
  font-variant-numeric: tabular-nums;
  color: var(--text-primary);
}
</style>
