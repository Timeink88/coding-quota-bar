<template>
  <div v-for="group in quotaGroups" :key="group.title" class="quota-row-single">
    <ModelQuotaCard :title="group.title" :quotas="group.quotas" />
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import ModelQuotaCard from './ModelQuotaCard.vue'
import type { AccountUsageData, QuotaItem } from '../types'

const props = defineProps<{
  account: AccountUsageData
}>()

const { t } = useI18n()

const quotaGroups = computed<{ title: string; quotas: QuotaItem[] }[]>(() => {
  const groups: { title: string; quotas: QuotaItem[] }[] = []
  // 周汇总行（limitType 'kimi'）排最前，其余按模型名（limitType）分组
  const weekly = (props.account.quotas ?? []).filter(q => q.limitType === 'kimi')
  if (weekly.length > 0) {
    groups.push({ title: t('quota.kimiWeekly'), quotas: weekly })
  }
  for (const q of props.account.quotas ?? []) {
    if (q.limitType === 'kimi') continue
    const title = q.limitType || q.label
    let group = groups.find(g => g.title === title)
    if (!group) {
      group = { title, quotas: [] }
      groups.push(group)
    }
    group.quotas.push(q)
  }
  return groups
})
</script>

<style scoped>
.quota-row-single {
  margin-bottom: 6px;
}
</style>
