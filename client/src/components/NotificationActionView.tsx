import type {DistributedRootRuntime} from '../multiplayer/DistributedRoot';
import {useNotificationAction} from '../multiplayer/useNotificationAction';
import type {NotificationAction} from '../multiplayer/notificationActions';
import type {Session} from '../multiplayer/session';
export function NotificationActionView({session,action,root}:{session:Session;action:NotificationAction;root?:DistributedRootRuntime}) {
  useNotificationAction(session,action,root);return null;
}
