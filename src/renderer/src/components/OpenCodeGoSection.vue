<template>
  <!-- 用量额度卡片 -->
  <div v-for="q in windowQuotas" :key="q.label" class="quota-row-single">
    <QuotaCard v-bind="q" />
  </div>

  <!-- Zen 余额卡片 -->
  <div v-if="zenBalanceItem" class="credits-card">
    <span class="credits-label">{{ $t(zenBalanceItem.label) }}</span>
    <span class="credits-value">{{ zenBalanceItem.used.toFixed(2) }} USD</span>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import QuotaCard from './QuotaCard.vue'
import type { AccountUsageData } from '../types'

const props = defineProps<{
  account: AccountUsageData
}>()

const windowQuotas = computed(() =>
  props.account.quotas.filter(q => q.limitType === 'opencodego')
)

const zenBalanceItem = computed(() =>
  props.account.quotas.find(q => q.currency === 'USD')
)
</script>

<style scoped>
.quota-row-single {
  margin-bottom: 6px;
}

.credits-card {
  display: flex;
  justify-content: space-between;
  align-items: baseline;
  padding: 8px 10px;
  background: var(--bg-card);
  border-radius: 8px;
  box-shadow: var(--shadow-card);
  margin-bottom: 6px;
  transition: background 0.2s, box-shadow 0.2s;
}

.credits-card:hover {
  background: var(--bg-card-hover);
  box-shadow: var(--shadow-card-hover);
}

.credits-label {
  font-size: 13px;
  font-weight: 600;
  color: var(--text-heading);
}

.credits-value {
  font-size: 18px;
  font-weight: 700;
  font-variant-numeric: tabular-nums;
  color: var(--text-primary);
}
</style>
