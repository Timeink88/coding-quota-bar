<template>
  <!-- 订阅等级 -->
  <div class="plan-card card" v-if="account.level">
    <span class="plan-label">{{ $t('subscription.plan') }}</span>
    <span class="plan-value">{{ account.level }}</span>
  </div>

  <!-- 额度项 -->
  <div v-for="q in account.quotas" :key="q.label" class="quota-row-single">
    <QuotaCard
      :label="q.label"
      :labelParams="q.labelParams"
      :usageRate="q.usageRate"
      :resetAt="q.resetAt"
      :color="q.color"
    />
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
.plan-card {
  display: flex;
  justify-content: space-between;
  align-items: baseline;
  margin-bottom: 8px;
}

.plan-label {
  font-size: 12px;
  color: var(--text-secondary);
}

.plan-value {
  font-size: 14px;
  font-weight: 600;
  color: var(--text-heading);
}

.quota-row-single {
  margin-bottom: 6px;
}
</style>
